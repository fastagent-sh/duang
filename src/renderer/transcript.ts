/** Fold session entries and live events into what the transcript shows. Pure, so it is testable. */
import type { SessionEntry, SessionEvent } from "@fastagent-sh/fastagent/session";

/**
 * When it happened. Required on every item, because both the day separators and the time under a
 * message read it — the transcript is a record, and a record without times reads as one moment.
 * Required rather than optional so a future producer that forgets it fails to compile, instead of
 * silently dropping a day boundary.
 */
type At = { at: number };

export type Item = At &
  ({ kind: "user"; text: string; steered?: boolean }
  | { kind: "assistant"; text: string; open: boolean }
  /**
   * `started` is kept because `at` is restamped when the block settles, and "thought for 8s" is
   * measured from the first token — after the restamp there is nothing left to measure from.
   */
  | { kind: "thinking"; text: string; open: boolean; started: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: unknown;
      isError?: boolean;
      status: "running" | "done" | "interrupted";
      /**
       * When it ran, from the live events only. History carries when the call was announced and when
       * its result was written, which is not how long the tool ran, so a reopened call shows no time.
       */
      started?: number;
      ended?: number;
    }
  /**
   * A fact about the session rather than something anyone said. `tone` decides whether it reads as
   * a quiet line or as a failure — stopping a run is not an error, and colouring it like one was
   * the transcript telling the person they broke something.
   */
  | { kind: "note"; tone: "info" | "warning" | "error"; text: string });

/**
 * A day as a separator says it. Crossing the calendar year is what earns the year, not a number of
 * days: read in January, a December conversation dated `Dec 25` looks like this year's.
 */
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

/** A day boundary in the reading flow: without it, yesterday's run reads as if it just happened. */
export type Line = Item | { kind: "day"; at: number };

/**
 * Items with the day boundaries between them. Pure, and separate from rendering, because "when did
 * this stop being the same day" is the only interesting part.
 */
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

/**
 * History: the three kinds the contract guarantees, in the shape FastAgent's adapter writes them.
 *
 * A tool call and its result arrive apart: the call is announced inside the assistant entry's
 * `toolCalls` (id and name only — arguments are not kept), and the result is its own `tool` entry
 * pointing back with `toolCallId`. Rendering them as one row is this function's whole job; anything
 * engine-specific is skipped, as the contract allows.
 */
export function fromEntries(entries: SessionEntry[], leafEntryId?: string): Item[] {
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
  for (const entry of entries) {
    const data = (entry.data ?? {}) as {
      text?: string;
      toolCalls?: { id?: string; name?: string }[];
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
    };
    const at = entry.timestamp;
    if (entry.kind === "user") {
      items.push({ kind: "user", text: data.text ?? "", at });
    } else if (entry.kind === "assistant") {
      if (data.text) items.push({ kind: "assistant", text: data.text, open: false, at });
      for (const call of data.toolCalls ?? []) {
        items.push({
          kind: "tool",
          id: call.id ?? "",
          name: call.name ?? "tool",
          args: undefined,
          status: "interrupted",
          at,
        });
      }
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
    }
  }
  return items;
}

/**
 * History read while a run is still going. A call with no result is interrupted in a finished
 * conversation, but in the running one the calls after the last user message are the active run's,
 * still executing. They get no `started`: when they began is not in the history, so they show no clock.
 */
export function resumeRunning(items: Item[]): Item[] {
  const turn = items.findLastIndex((item) => item.kind === "user");
  return items.map((item, index) =>
    index > turn && item.kind === "tool" && item.status === "interrupted" ? { ...item, status: "running" } : item,
  );
}

/**
 * What a tool printed, out of the envelope it arrived in. A result reaches us as MCP-shaped content
 * (`{ content: [{ type: "text", text }] }`, sometimes nested once more), and dumping that verbatim
 * shows the person the protocol instead of the output — quoted, escaped, and three braces deep.
 *
 * Text parts only. Anything else — an image part, a shape we have not seen — keeps its JSON rather than
 * being silently dropped, because a result nobody can see is worse than an ugly one.
 */
export function toolText(result: unknown): string {
  let value = result;
  // Depth-limited instead of recursive: the envelope is one or two deep, and a cycle here would
  // hang the renderer.
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

/**
 * The head a long tool payload folds to, or `undefined` when it fits. Lines and characters both
 * count: a minified JSON body or a one-line log has one line and no ceiling, and wrapped with
 * `break-all` it would fill the transcript. 1500 characters is about twelve full lines of the
 * reading column, so the two limits fold at roughly the same height.
 */
export function foldHead(text: string): string | undefined {
  const head = text.split("\n").slice(0, 12).join("\n").slice(0, 1_500);
  return head.length < text.length ? head : undefined;
}

/**
 * How long a tool ran, in pi's words for it: tenths under a minute, then minutes and hours. A running
 * clock ticks once a second, so it gets whole seconds: tenths that only move with the second would
 * claim a precision it does not have.
 */
export function duration(ms: number, running = false): string {
  const seconds = ms / 1000;
  if (seconds < 60) return running ? `${Math.floor(seconds)}s` : `${seconds.toFixed(1)}s`;
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${total % 60}s`;
}

/** Tool payloads are JSON, except when the runtime already handed us a string. */
export function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** A tool call's most telling argument — the path, command or query, not the whole object. */
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

/**
 * What a roster row quotes: the newest thing said or done in a conversation, as plain text. Thinking
 * is not output and an answer with no text yet has nothing to say, so both are passed over. Markdown
 * loses only the marks that would show up as noise in two lines of plain text.
 */
export function previewOf(items: Item[]): { text: string; at: number } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const text =
      item.kind === "user"
        ? `You: ${item.text}`
        : item.kind === "assistant" || item.kind === "note"
          ? item.text
          : item.kind === "tool"
            ? `${item.name} ${firstArg(item.args)}`
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

/**
 * Thinking ends when the model starts doing something else — answering or calling a tool — not
 * when the whole message settles. The message can go on for minutes after its thinking stopped, and
 * the block's `at` is what `thinking · Ns` is measured to.
 */
function stopThinking(items: Item[], at: number): Item[] {
  return items.map((item) => (item.kind === "thinking" && item.open ? { ...item, open: false, at } : item));
}

/** One live event applied to the list. Returns a new list; unknown event types change nothing. */
export function apply(items: Item[], event: SessionEvent): Item[] {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case "message_delta": {
      const last = items.at(-1);
      const delta = String(data.delta ?? "");
      if (data.channel === "thinking") {
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
      // Stamped on settling, not on the first delta: an answer that streamed for five minutes would
      // otherwise show one time live and another after a reopen, where history carries the time
      // FastAgent wrote the entry. Only what is still open settles here — restamping an item that
      // already settled moves the time under an older answer, and stretches `thinking · Ns` to
      // the end of every later message.
      return items.map((item) =>
        (item.kind === "assistant" || item.kind === "thinking") && item.open
          ? { ...item, open: false, at: event.timestamp }
          : item,
      );
    }
    case "tool_started":
      return [
        ...stopThinking(items, event.timestamp),
        {
          kind: "tool",
          id: String(data.id),
          name: String(data.name),
          args: data.args,
          status: "running",
          at: event.timestamp,
          started: event.timestamp,
        },
      ];
    case "tool_progress":
    case "tool_finished": {
      const id = String(data.id);
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === id);
      if (index < 0) return items;
      const tool = items[index] as Extract<Item, { kind: "tool" }>;
      const updated: Item =
        event.type === "tool_finished"
          ? { ...tool, result: data.content, isError: Boolean(data.isError), status: "done", ended: event.timestamp }
          : { ...tool, result: data.partialResult };
      return [...items.slice(0, index), updated, ...items.slice(index + 1)];
    }
    case "run_settled": {
      items = items.map((item): Item => {
        if (item.kind === "assistant" || item.kind === "thinking") return { ...item, open: false };
        if (item.kind === "tool" && item.status === "running")
          return { ...item, status: "interrupted", ended: event.timestamp };
        return item;
      });
      if (data.status === "completed") return items;
      const stopped = data.status === "aborted";
      // An aborted run carries the abort machinery's own words ("This operation was aborted",
      // "Request aborted"). The person pressed Stop; that is the whole explanation. Only a FAILED
      // run has a reason they could not already know, so only that one keeps its message.
      const error = stopped ? undefined : (data.error as { message?: string } | undefined);
      return [
        ...items,
        {
          kind: "note",
          at: event.timestamp,
          tone: stopped ? "info" : "error",
          // One vocabulary (§9): a run the person ended is `stopped`, never the abort machinery's
          // `aborted`, and never `failed` — that word blames the run for their decision.
          text: `run ${stopped ? "stopped" : String(data.status)}${error?.message ? `: ${error.message}` : ""}`,
        },
      ];
    }
    case "retry_scheduled":
      return [
        ...items,
        {
          kind: "note",
          tone: "error",
          at: event.timestamp,
          text: `retrying ${String(data.attempt)}/${String(data.maxAttempts)}: ${String(data.error ?? "")}`,
        },
      ];
    case "serving_error":
      return [...items, { kind: "note", tone: "error", text: String(data.message), at: event.timestamp }];
    default:
      return items;
  }
}
