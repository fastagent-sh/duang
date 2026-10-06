import type {
  AnswerOutcome,
  KnownSessionEvent,
  ServingErrorEvent,
  SessionEntry,
  SessionEvent,
  SessionState,
} from "@fastagent-sh/fastagent/session";
import { explainRunFailure, recognise, type Fix } from "./problems.ts";

// Required, not optional: day separators and message times read it, and a producer that forgets it must not compile.
type At = { at: number };

export type Item = At &
  ({ kind: "user"; text: string; steered?: boolean; entryId?: string; opens?: boolean }
  | { kind: "assistant"; text: string; open: boolean }
  // `started` survives the restamp of `at` on settling; "thought for 8s" counts from the first token.
  | { kind: "thinking"; text: string; open: boolean; started: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: unknown;
      isError?: boolean;
      status: "running" | "done" | "interrupted";
      // Live only: history carries when the call was announced and its result written, not how long it ran.
      started?: number;
      ended?: number;
    }
  // With a `title`: a problem drawn as a card. Without: a quiet line; a stop or retry is not an error.
  // `resend`: Retry's message, and whether that run had started a tool (sending again may repeat it).
  | {
      kind: "note";
      tone: "info" | "warning" | "error";
      text: string;
      title?: string;
      advice?: string;
      reason?: string;
      fix?: Fix;
      resend?: { text: string; toolsRan: boolean };
      limit?: string;
      retry?: number;
      of?: number;
    });

type RetryNote = Extract<Item, { kind: "note" }> & { retry: number };
const isRetry = (item: Item | undefined): item is RetryNote => item?.kind === "note" && !!item.retry;
const retriedText = (count: number, reason: string) => `retried ${count === 1 ? "once" : `${count} times`}: ${retryReason(reason)}`;

// A retry the run went on from reads in the past tense: `retrying 2/3` would claim a wait that is over.
export function wentOn(items: Item[]): Item[] {
  const index = items.findLastIndex((item) => isRetry(item) && item.of !== undefined);
  if (index < 0) return items;
  const { of: _waiting, ...note } = items[index] as RetryNote;
  return items.with(index, { ...note, text: retriedText(note.retry, note.reason ?? "") });
}

// Never a failure's ending: a retrying run goes on.
const retryReason = (reason: string) => {
  const title = recognise(reason)?.title;
  return title ? title.charAt(0).toLowerCase() + title.slice(1) : reason.split("\n")[0]!;
};

function failed(reason: string) {
  // OpenAI's documented code for a ChatGPT plan's limit, which pi passes on in the run's error.
  if (reason.includes("subscription_sharing_usage_limit_exceeded"))
    return {
      title: "Your ChatGPT plan has reached its limit",
      advice: "Its usage page says when it resets. Until then, another model can take the message.",
      reason,
      limit: "openai",
      fix: "model" as const,
    };
  return { ...explainRunFailure(reason), reason };
}

// Crossing the calendar year earns the year: read in January, `Dec 25` looks like this year's.
export function dayLabel(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((midnight.getTime() - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

export type UserItem = Extract<Item, { kind: "user" }>;

// Else the oldest slash command: the runtime reports a command expanded.
// ponytail: text is the only key; a client-supplied prompt id upstream is the fix if several clients steer at once.
export function claim(waiting: UserItem[], text: string): UserItem | undefined {
  return waiting.find((item) => item.text === text) ?? waiting.find((item) => item.text.startsWith("/"));
}

// A message sent during a compaction opens the run after it, not the compaction it did not ask for.
export function opensRun(status: SessionState["status"] | undefined, runHasUser: boolean): boolean {
  if (status === "compacting") return false;
  return status !== "running" || !runHasUser;
}

// `opens`: reads above the run's working mark, since that work is what it asked for.
export function queueView(waiting: UserItem[], pending: string[]): { item: UserItem; listed: boolean; opens: boolean }[] {
  let left = waiting;
  const listed = pending.map((text) => {
    const own = claim(left, text);
    if (own) left = left.filter((item) => item !== own);
    // Listed as queued, it is a steer for the run on screen, whatever it was sent as.
    return { item: own ?? { kind: "user" as const, text, at: 0 }, listed: true, opens: false };
  });
  return [...listed, ...left.map((item) => ({ item, listed: false, opens: item.opens === true }))];
}

export type Line = Item | { kind: "day"; at: number };

// Counted from the turn's opening message: a conversation read back from history loses lines only this window
// showed ("Not sent", `ran /cmd`), so counting from the start would come back off by those.
export type Place = { turn?: string; row: number; offset: number };

export function placeAt(shown: (Line | Work)[], index: number, offset: number): Place {
  for (let at = index; at >= 0; at--) {
    const line = shown[at]!;
    if (line.kind === "user" && line.entryId !== undefined) return { turn: line.entryId, row: index - at, offset };
  }
  return { row: index, offset };
}

export function lineOf(shown: (Line | Work)[], place: Place): number | undefined {
  if (place.turn === undefined) return place.row;
  const at = shown.findIndex((line) => line.kind === "user" && line.entryId === place.turn);
  return at === -1 ? undefined : at + place.row;
}

export function lines(items: Item[]): Line[] {
  const out: Line[] = [];
  let day: string | undefined;
  for (const item of items) {
    const stamp = new Date(item.at).toDateString();
    if (day !== undefined && stamp !== day) out.push({ kind: "day", at: item.at });
    day = stamp;
    out.push(item);
  }
  return out;
}

type Tool = Extract<Item, { kind: "tool" }>;
type Thinking = Extract<Item, { kind: "thinking" }>;

export type Work = { kind: "work"; items: (Tool | Thinking)[] };

// A lone call is a block too, so it stays the same element when the next call joins it and an open card
// does not close under the reader.
export function group(lines: Line[]): (Line | Work)[] {
  const out: (Line | Work)[] = [];
  for (const line of lines) {
    const previous = out.at(-1);
    if (line.kind !== "tool" && line.kind !== "thinking") out.push(line);
    else if (previous?.kind === "work") previous.items.push(line);
    else out.push({ kind: "work", items: [line] });
  }
  return out;
}

// The status is drawn in the newest line when that line is the step itself, never beside a line saying the same.
export function liveEnd(
  shown: (Line | Work)[],
  busy: boolean,
  opening: boolean,
): { status: boolean; block?: Work; hidden?: Line; quietOnly: boolean; above?: string } {
  const end = shown.at(-1);
  const now = busy && !opening ? end : undefined;
  const block =
    now?.kind === "work" &&
    now.items.some((item) => (item.kind === "tool" && item.status === "running") || (item.kind === "thinking" && item.open))
      ? now
      : undefined;
  const hidden = now?.kind === "note" && now.of !== undefined ? now : undefined;
  return {
    status: busy && !block,
    ...(block && { block }),
    ...(hidden && { hidden }),
    quietOnly: now?.kind === "assistant" && now.open,
    above: opening ? "user" : (hidden ? shown.at(-2) : end)?.kind,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const WORK = [
  { tools: ["read"], doing: "reading", did: (n: number) => `read ${plural(n, "file")}`, distinct: true },
  { tools: ["grep", "find", "ls"], doing: "searching", did: (n: number) => `searched ${n === 1 ? "once" : `${n} times`}` },
  { tools: ["edit", "write"], doing: "editing", did: (n: number) => `changed ${plural(n, "file")}`, distinct: true },
  { tools: ["bash"], doing: "running", did: (n: number) => `ran ${plural(n, "command")}` },
  { tools: ["fetch"], doing: "fetching", did: (n: number) => `fetched ${plural(n, "page")}` },
];

// A failed call is not counted apart: the agent reads its own failures. A call that never finished is
// (`1 stopped`): reopened from history, nothing else says the run was cut.
export function summarize(items: Work["items"]): string {
  const all = items.filter((item): item is Tool => item.kind === "tool");
  const tools = all.filter((tool) => tool.status !== "running");
  // How long, when it is known and worth saying; read back from history it is not, and the thought still counts.
  const thoughts = items.filter((item): item is Thinking => item.kind === "thinking" && !item.open);
  const thought = thoughts.reduce((ms, item) => ms + item.at - item.started, 0);
  const parts = thoughts.length ? [thought >= 1000 ? `thought ${Math.round(thought / 1000)}s` : "thought"] : [];
  for (const kind of WORK) {
    const mine = tools.filter((tool) => kind.tools.includes(tool.name));
    const n = kind.distinct ? new Set(mine.map((tool) => (tool.args as { path?: unknown } | undefined)?.path ?? tool.id)).size : mine.length;
    if (n) parts.push(kind.did(n));
  }
  const others = new Map<string, number>();
  for (const tool of tools) if (!WORK.some((kind) => kind.tools.includes(tool.name))) others.set(tool.name, (others.get(tool.name) ?? 0) + 1);
  for (const [name, n] of others) parts.push(`used ${name}${n > 1 ? ` ×${n}` : ""}`);
  const stopped = tools.filter((tool) => tool.status === "interrupted").length;
  if (stopped) parts.push(`${stopped} stopped`);
  const running = all.length - tools.length;
  if (running) parts.push(`${running} running`);
  return parts.join(", ") || "thought";
}

// A streaming block's last line is usually a fragment, so show its last complete line. Unspaced scripts
// (Chinese, Japanese) show the text so far; a spaced script's lone first word may be half-written.
export function thinkingLine(text: string, streaming = false): string {
  const last = (lines: string) => lines.trim().split("\n").at(-1) ?? "";
  if (!streaming || text.endsWith("\n")) return last(text);
  const complete = last(text.slice(0, Math.max(0, text.lastIndexOf("\n"))));
  if (complete) return complete;
  const words = text.trim();
  const space = words.lastIndexOf(" ");
  if (space >= 0) return words.slice(0, space);
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(words) ? words : "";
}

export type Activity = "thinking" | "tool" | "answering";

export function phase(
  items: Item[],
  status: SessionState["status"] | undefined,
): { word: string; detail?: string; activity: Activity } {
  if (status === "compacting") return { word: "compacting", activity: "thinking" };
  if (status !== "running") return { word: "starting", activity: "thinking" };
  const running = items.filter((item): item is Tool => item.kind === "tool" && item.status === "running");
  if (running.length > 1) return { word: `running ${running.length} tools`, activity: "tool" };
  const tool = running[0];
  if (tool) {
    const kind = WORK.find((candidate) => candidate.tools.includes(tool.name));
    const arg = firstArg(tool.args);
    return kind
      ? { word: kind.doing, detail: arg, activity: "tool" }
      : { word: "running", detail: `${tool.name} ${arg}`.trim(), activity: "tool" };
  }
  const last = items.at(-1);
  if (last?.kind === "assistant" && last.open) return { word: "answering", activity: "answering" };
  // Waiting out pi's retry delay is not thinking: it says the retry, and what it is retrying.
  if (isRetry(last) && last.of !== undefined)
    return { word: `retrying ${last.retry}/${last.of}`, detail: retryReason(last.reason ?? ""), activity: "thinking" };
  const thought = last?.kind === "thinking" && last.open ? thinkingLine(last.text, true) || undefined : undefined;
  return { word: "thinking", detail: thought, activity: "thinking" };
}

// A tool call and its result arrive apart (`toolCalls` in the answer, then a `tool` entry by `toolCallId`).
// A conversation not running that stops mid-turn was cut with nothing recorded, unless every call carries
// `terminate` (pi ended the run on purpose). Calls after the last user message of a running conversation are
// still executing; history has no start time for them.
export function fromEntries(entries: SessionEntry[], leafEntryId?: string, running = false): Item[] {
  if (leafEntryId) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const path: SessionEntry[] = [];
    const seen = new Set<string>();
    let id: string | undefined = leafEntryId;
    while (id) {
      const entry = byId.get(id);
      if (!entry || seen.has(id)) throw new Error(`Invalid session entry chain at ${id}`);
      seen.add(id);
      path.push(entry);
      id = entry.parentId;
    }
    entries = path.reverse();
  }
  const items: Item[] = [];
  let failure: { index: number; message: string } | undefined;
  // History does not say where a run began; the live view counts from `run_started` instead.
  let unconcluded = 0;
  let open = false;
  let batch = new Map<string, boolean>();
  const concluded = (index: number) => {
    const before = items[index - 1];
    if (before?.kind !== "note" || !before.retry) return index;
    items.splice(index - 1, 1);
    return index - 1;
  };
  const retried = () => {
    if (!failure) return;
    const { index, message } = failure;
    failure = undefined;
    // Retries in a row are one line that counts them.
    const previous = items[index - 1];
    const count = previous?.kind === "note" && previous.retry ? previous.retry + 1 : 1;
    const at = items[index]!.at;
    if (count > 1) items.splice(index - 1, 1);
    items[count > 1 ? index - 1 : index] = {
      kind: "note",
      tone: "info",
      text: retriedText(count, message),
      reason: message,
      retry: count,
      at,
    };
  };
  for (const entry of entries) {
    const data = (entry.data ?? {}) as {
      text?: string;
      toolCalls?: { id?: string; name?: string; args?: unknown }[];
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
      outcome?: AnswerOutcome;
      terminate?: true;
      thinking?: string;
    };
    const at = entry.timestamp;
    if (entry.kind === "user") {
      // The failure ended its run; what follows is the next one.
      if (failure) unconcluded = concluded(failure.index) + 1;
      failure = undefined;
      open = true;
      items.push({ kind: "user", text: data.text ?? "", at, entryId: entry.id });
    } else if (entry.kind === "assistant") {
      retried();
      // How long it took is not recorded.
      if (data.thinking) items.push({ kind: "thinking", text: data.thinking, open: false, started: at, at });
      if (data.text) items.push({ kind: "assistant", text: data.text, open: false, at });
      for (const call of data.toolCalls ?? []) {
        items.push({
          kind: "tool",
          id: call.id ?? "",
          name: call.name ?? "tool",
          args: call.args,
          status: "interrupted",
          at,
        });
      }
      const outcome = data.outcome;
      if (outcome?.status === "truncated") items.push({ kind: "note", tone: "info", text: TRUNCATED, at });
      else if (outcome?.status === "aborted") items.push({ kind: "note", tone: "info", text: "run stopped", at });
      else if (outcome?.status === "failed") {
        const message = outcome.error?.message ?? "";
        const turn = items.findLast((item) => item.kind === "user");
        const toolsRan = items.slice(unconcluded).some((item) => item.kind === "tool");
        failure = { index: items.length, message };
        items.push({
          kind: "note",
          tone: "error",
          text: `run failed${message ? `: ${message}` : ""}`,
          at,
          ...(turn?.kind === "user" ? { resend: { text: turn.text, toolsRan } } : {}),
          ...failed(message),
        });
      }
      // An answer with no tool call ends its work: a later failure cannot repeat what came before it.
      if (!outcome && !data.toolCalls?.length) unconcluded = items.length;
      open = !outcome && !!data.toolCalls?.length;
      batch = new Map((data.toolCalls ?? []).map((call) => [call.id ?? "", false]));
    } else if (entry.kind === "tool") {
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === data.toolCallId);
      const result: Item = {
        at,
        kind: "tool",
        id: data.toolCallId ?? entry.id,
        name: data.toolName ?? "tool",
        args: index < 0 ? undefined : (items[index] as Extract<Item, { kind: "tool" }>).args,
        result: data.text ?? "",
        isError: data.isError ?? false,
        status: "done",
      };
      if (index < 0) items.push(result);
      else items[index] = result;
      if (data.terminate && batch.has(result.id)) batch.set(result.id, true);
      // Every call asked to end the run: it ended here on purpose.
      const ended = batch.size > 0 && [...batch.values()].every(Boolean);
      open = !ended;
      if (ended) unconcluded = items.length;
    }
  }
  if (!running && failure) concluded(failure.index);
  if (!running) {
    const turn = items.findLast((item) => item.kind === "user");
    if (open && turn?.kind === "user")
      items.push({
        kind: "note",
        tone: "error",
        text: "run cut short: no answer was recorded",
        title: "This run was cut short",
        advice: "duang or the computer stopped before an answer was recorded. What it did up to here is kept.",
        at: items.at(-1)!.at,
        resend: { text: turn.text, toolsRan: items.slice(unconcluded).some((item) => item.kind === "tool") },
      });
    return items;
  }
  // A failure the running run has not answered yet is a retry waiting out its delay.
  retried();
  const turn = items.findLastIndex((item) => item.kind === "user");
  return items.map((item, index) =>
    index > turn && item.kind === "tool" && item.status === "interrupted" ? { ...item, status: "running" } : item,
  );
}

const TRUNCATED = "answer cut off at the model's output limit";

// Results arrive MCP-shaped (`{ content: [{ type: "text", text }] }`). Anything but text parts keeps its JSON:
// a result nobody can see is worse than an ugly one.
export function toolText(result: unknown): string {
  let value = result;
  // Depth-limited: the envelope is one or two deep, and a cycle would hang the renderer.
  for (let depth = 0; depth < 3; depth++) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const parts = value.map((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : undefined,
      );
      return parts.every((part) => part !== undefined) ? parts.join("\n") : stringify(result);
    }
    if (value && typeof value === "object" && "content" in value) {
      value = (value as { content: unknown }).content;
      continue;
    }
    break;
  }
  return stringify(result);
}

// Characters count too: minified JSON has one line and no ceiling. 1500 characters is about twelve lines.
export function foldHead(text: string): string | undefined {
  const head = text.split("\n").slice(0, 12).join("\n").slice(0, 1_500);
  return head.length < text.length ? head : undefined;
}

// A running clock ticks once a second, so tenths would claim a precision it does not have.
export function duration(ms: number, running = false): string {
  const seconds = ms / 1000;
  if (seconds < 60) return running ? `${Math.floor(seconds)}s` : `${seconds.toFixed(1)}s`;
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

export function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function firstArg(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const entry = Object.entries(args as Record<string, unknown>).find(([, value]) => typeof value === "string");
  if (!entry) return "";
  const text = entry[1] as string;
  // Only a path argument is a path; a command starting with / still needs its executable.
  if (entry[0] === "path" && text.startsWith("/")) return `…/${text.split("/").filter(Boolean).slice(-2).join("/")}`;
  return text.length <= 72 ? text : `${text.slice(0, 71)}…`;
}

// Settled thinking is not output and is passed over. While calls run, the newest still running is quoted,
// not a later one already finished (`ls` beside a running `sleep`).
export function previewOf(items: Item[]): { text: string; at: number } | undefined {
  const running = items.findLastIndex((item) => item.kind === "tool" && item.status === "running");
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (running >= 0 && i > running && item.kind === "tool") continue;
    const text =
      item.kind === "user"
        ? `You: ${item.text}`
        : item.kind === "assistant"
          ? item.text
          : item.kind === "note"
            ? // A problem is quoted by what it means, not by the provider's raw words.
              item.title ?? item.text
          : item.kind === "tool"
            ? `${item.name} ${firstArg(item.args)}`
            : item.kind === "thinking" && item.open
              ? ["thinking", thinkingLine(item.text, true)].filter(Boolean).join(": ")
              : "";
    const plain = text
      .replace(/^(#{1,6}|>)\s*/gm, "")
      .replace(/```\w*|`|\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (plain) return { text: plain, at: item.at };
  }
  return undefined;
}

// Thinking ends when the model does something else, not when the message settles minutes later.
function stopThinking(items: Item[], at: number): Item[] {
  return items.map((item) => (item.kind === "thinking" && item.open ? { ...item, open: false, at } : item));
}

// The one cast: narrowed by `type`, so a field the contract renames fails to compile.
type ReadEvent = KnownSessionEvent | ServingErrorEvent;
export const known = (event: SessionEvent) => event as ReadEvent;

// Unchanged items stay the same object: `SettledMessage` skips them, or every streamed word redraws everything.
export function apply(items: Item[], event: SessionEvent): Item[] {
  const e = known(event);
  switch (e.type) {
    case "message_delta": {
      items = wentOn(items);
      const last = items.at(-1);
      const delta = e.data.delta;
      if (e.data.channel === "thinking") {
        if (last?.kind === "thinking" && last.open) {
          return [...items.slice(0, -1), { ...last, text: last.text + delta }];
        }
        return [...items, { kind: "thinking", text: delta, open: true, at: event.timestamp, started: event.timestamp }];
      }
      if (last?.kind === "assistant" && last.open) {
        return [...items.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [...stopThinking(items, event.timestamp), { kind: "assistant", text: delta, open: true, at: event.timestamp }];
    }
    case "message_finished": {
      // Stamped on settling, matching the time history carries. Only open items: restamping a settled one moves
      // an older answer's time and stretches `thinking · Ns`.
      const settled = items.map((item) =>
        (item.kind === "assistant" || item.kind === "thinking") && item.open
          ? { ...item, open: false, at: event.timestamp }
          : item,
      );
      // A failed or stopped answer is said by the run's own ending (`run_settled`), or by the retry pi schedules.
      return e.data.outcome?.status === "truncated"
        ? [...settled, { kind: "note", tone: "info", text: TRUNCATED, at: event.timestamp }]
        : settled;
    }
    case "tool_started":
      return [
        ...stopThinking(wentOn(items), event.timestamp),
        {
          kind: "tool",
          id: e.data.id,
          name: e.data.name,
          args: e.data.args,
          status: "running",
          at: event.timestamp,
          started: event.timestamp,
        },
      ];
    case "tool_progress":
    case "tool_finished": {
      const id = e.data.id;
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === id);
      if (index < 0) return items;
      const tool = items[index] as Extract<Item, { kind: "tool" }>;
      const updated: Item =
        e.type === "tool_finished"
          ? { ...tool, result: e.data.content, isError: e.data.isError, status: "done", ended: event.timestamp }
          : { ...tool, result: e.data.partialResult };
      return [...items.slice(0, index), updated, ...items.slice(index + 1)];
    }
    case "run_settled": {
      items = items.map((item): Item => {
        if ((item.kind === "assistant" || item.kind === "thinking") && item.open) return { ...item, open: false };
        if (item.kind === "tool" && item.status === "running")
          return { ...item, status: "interrupted", ended: event.timestamp };
        return item;
      });
      // A run that ends after pi's retries no longer needs the line counting them: its ending says how it ended.
      const lastLine = items.at(-1);
      if (lastLine?.kind === "note" && lastLine.retry) items = items.slice(0, -1);
      if (e.data.status === "completed") return items;
      const stopped = e.data.status === "aborted";
      // A stopped run carries the abort machinery's words; the person pressed Stop, so only a failure keeps its message.
      const error = stopped ? undefined : e.data.error;
      return [
        ...items,
        {
          kind: "note",
          at: event.timestamp,
          tone: stopped ? "info" : "error",
          // A run the person ended is `stopped`, never `aborted` or `failed` (§9).
          text: `run ${stopped ? "stopped" : e.data.status}${error?.message ? `: ${error.message}` : ""}`,
          ...(stopped ? {} : failed(error?.message ?? "")),
        },
      ];
    }
    case "retry_scheduled":
      // pi tries again by itself: a quiet line that moves on with each attempt, not a failure.
      return [
        ...(items.at(-1)?.kind === "note" && (items.at(-1) as { retry?: number }).retry ? items.slice(0, -1) : items),
        {
          kind: "note",
          tone: "info",
          at: event.timestamp,
          text: `retrying ${e.data.attempt}/${e.data.maxAttempts}: ${retryReason(e.data.error)}`,
          reason: e.data.error,
          retry: e.data.attempt,
          of: e.data.maxAttempts,
        },
      ];
    case "serving_error":
      return [
        ...items,
        {
          kind: "note",
          tone: "error",
          text: e.data.message,
          title: "The agent's runtime reported a problem",
          reason: e.data.message,
          at: event.timestamp,
        },
      ];
    default:
      return items;
  }
}
