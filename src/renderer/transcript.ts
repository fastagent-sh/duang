/** Fold session entries and live events into what the transcript shows. Pure, so it is testable. */
import type {
  AnswerOutcome,
  KnownSessionEvent,
  ServingErrorEvent,
  SessionEntry,
  SessionEvent,
  SessionState,
} from "@fastagent-sh/fastagent/session";
import { explainRunFailure, recognise, type Fix } from "./problems.ts";

/**
 * When it happened. Required on every item, because both the day separators and the time under a
 * message read it — the transcript is a record, and a record without times reads as one moment.
 * Required rather than optional so a future producer that forgets it fails to compile, instead of
 * silently dropping a day boundary.
 */
type At = { at: number };

export type Item = At &
  /**
   * `steered`: it joined a run that already had a user message. `entryId`: the runtime's record of it,
   * from history or from `user_message`, so a backfill and a live event are one bubble. `opens`: while
   * it waits, it was sent with no run to join (see {@link opensRun}).
   */
  ({ kind: "user"; text: string; steered?: boolean; entryId?: string; opens?: boolean }
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
   * A fact about the session rather than something anyone said. One with a `title` is a problem the
   * person may have to act on, drawn as a card: what it means (`title`, `advice`), the original
   * `reason` verbatim, and the way on. One without is a quiet line (`text`): stopping a run or a
   * retry is not an error, and colouring it like one was the transcript telling the person they broke
   * something. `text` is the one-line form a roster row quotes.
   *
   * `resend`: the failure of a run that had taken a message, the one Retry sends again, and whether that
   * run had started a tool (sending it again may repeat that work). `limit`: a plan's usage limit, and
   * the provider whose usage page says more. `fix`: where in duang the way on is.
   */
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
      /** pi trying the answer again by itself: how many times so far. Consecutive ones are one line. */
      retry?: number;
      /** A retry still waiting, live: of how many pi will make. Absent once the run went on from it. */
      of?: number;
    });

type RetryNote = Extract<Item, { kind: "note" }> & { retry: number };
const isRetry = (item: Item | undefined): item is RetryNote => item?.kind === "note" && !!item.retry;
const retriedText = (count: number, reason: string) => `retried ${count === 1 ? "once" : `${count} times`}: ${retryReason(reason)}`;

/**
 * A retry the run went on from (an answer, a thought, a call, or a steer the next attempt took in came after it)
 * is said in the past, as it reads back from history: `retrying 2/3` would claim a wait that is over.
 */
export function wentOn(items: Item[]): Item[] {
  const index = items.findLastIndex((item) => isRetry(item) && item.of !== undefined);
  if (index < 0) return items;
  const { of: _waiting, ...note } = items[index] as RetryNote;
  return items.with(index, { ...note, text: retriedText(note.retry, note.reason ?? "") });
}

/**
 * A retry's reason in a quiet line: what it means when that is recognised, else the reason's own first line.
 * Never a failure's ending ("the run stopped"): a retrying run goes on. The words in full stay on the line.
 */
const retryReason = (reason: string) => {
  const title = recognise(reason)?.title;
  return title ? title.charAt(0).toLowerCase() + title.slice(1) : reason.split("\n")[0]!;
};

/** A run's failure, as the card says it: what it means, the reason verbatim, and a plan limit's page. */
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

export type UserItem = Extract<Item, { kind: "user" }>;

/**
 * Which of this window's own waiting messages a text from the runtime is: the oldest with that text,
 * else the oldest slash command, because the runtime reports a command expanded (or, for an extension
 * command, the message it sent). Anything else is a message from another client or from before a reload.
 * ponytail: text is the only key. A message from elsewhere queued ahead of one of our commands takes
 * the command's place; a client-supplied prompt id upstream is the fix if several clients steer at once.
 */
export function claim(waiting: UserItem[], text: string): UserItem | undefined {
  return waiting.find((item) => item.text === text) ?? waiting.find((item) => item.text.startsWith("/"));
}

/**
 * Whether a message sent now opens a run rather than joins one, decided when it is sent: nothing is
 * running, or the run on screen has not placed its user message yet. A message sent during a
 * compaction does not open the compaction, which it did not ask for; it opens the run after it,
 * while a `/compact` sent from idle opens the compaction itself.
 */
export function opensRun(status: SessionState["status"] | undefined, runHasUser: boolean): boolean {
  if (status === "compacting") return false;
  return status !== "running" || !runHasUser;
}

/**
 * The bubbles below the live output: the runtime's queue first, in its order, each shown as this
 * window's own message when it is one; then messages sent from here that the runtime has not listed
 * yet. `listed` is what the runtime reports as queued; the rest are still on their way. `opens`: it
 * reads above the run's working mark rather than below it, since that work is what it asked for.
 */
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

/** A day boundary in the reading flow: without it, yesterday's run reads as if it just happened. */
export type Line = Item | { kind: "day"; at: number };

/**
 * Where a conversation was left above its latest line: the line at the top of the view and how far its top is from
 * the view's top. The line is counted from the person's message that opened its turn (`turn`, the runtime's entry
 * id; absent before the first message), because a conversation left idle is read back from history on return and
 * loses the lines only this window showed (a "Not sent" note, `ran /cmd`): counted from the start, every line after
 * one of those would come back one off. Lines drawn above it later and lines added under it move neither.
 */
export type Place = { turn?: string; row: number; offset: number };

/** The place of the line at `index`, `offset` from the view's top. */
export function placeAt(shown: (Line | Work)[], index: number, offset: number): Place {
  for (let at = index; at >= 0; at--) {
    const line = shown[at]!;
    if (line.kind === "user" && line.entryId !== undefined) return { turn: line.entryId, row: index - at, offset };
  }
  return { row: index, offset };
}

/** The index of the line a place names, or undefined when its message is no longer in the conversation. */
export function lineOf(shown: (Line | Work)[], place: Place): number | undefined {
  if (place.turn === undefined) return place.row;
  const at = shown.findIndex((line) => line.kind === "user" && line.entryId === place.turn);
  return at === -1 ? undefined : at + place.row;
}

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

type Tool = Extract<Item, { kind: "tool" }>;
type Thinking = Extract<Item, { kind: "thinking" }>;

/**
 * A stretch of work between two things worth reading: every tool call and thinking block in a row.
 * One line per call made a reading session of twenty files twenty lines tall, and none of them said
 * anything the person needed; what they need is what kind of work it was.
 */
export type Work = { kind: "work"; items: (Tool | Thinking)[] };

/**
 * Consecutive asides as one {@link Work} block each, a lone one included: a call that stands alone
 * now is the first of a block once the next call arrives, and it must stay the same element on
 * screen when that happens, or the card someone is reading closes under them. The view draws a
 * one-item block as the item alone.
 */
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

/**
 * How the live end of a run is drawn: one line saying what the run is doing. Where the newest line already is
 * that step, it is that line, never one above another saying the same:
 *
 * - calls running, or a thought being written: that block carries the status itself (`block`);
 * - a retry pi is waiting out: the status says it, and the waiting line is not drawn (`hidden`);
 * - an answer being written: its own sign of life, so the status is drawn only once it stops coming
 *   (`quietOnly`);
 * - otherwise, or with a sent message waiting to open the next turn, the status line stands on its own.
 *
 * `above` is the kind of the line the status follows, for the space between them: the last line drawn.
 */
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

/**
 * Tools by the kind of work they do: how a running one is described, and how a finished stretch counts
 * them. Anything else is named by its own name.
 */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const WORK = [
  { tools: ["read"], doing: "reading", did: (n: number) => `read ${plural(n, "file")}`, distinct: true },
  { tools: ["grep", "find", "ls"], doing: "searching", did: (n: number) => `searched ${n === 1 ? "once" : `${n} times`}` },
  { tools: ["edit", "write"], doing: "editing", did: (n: number) => `changed ${plural(n, "file")}`, distinct: true },
  { tools: ["bash"], doing: "running", did: (n: number) => `ran ${plural(n, "command")}` },
  { tools: ["fetch"], doing: "fetching", did: (n: number) => `fetched ${plural(n, "page")}` },
];

/**
 * A work block in one line: `read 9 files, ran 6 commands`. A call that failed is not counted apart:
 * the agent reads its own failures and carries on, so it asks nothing of the person, and the run's
 * outcome is what says whether the work as a whole failed. A call that never finished is (`, 1
 * stopped`): the agent never read a result and the run did not go on, and reopened from history
 * nothing else says the run was cut short. Files are counted once however often they were read, live
 * and reopened alike (history keeps each call's arguments); a call with no path counts once each.
 * Only finished calls are counted as done: one still running is `2 running`, and the live status below
 * says what it is, so the block never claims in the past tense what is still happening.
 */
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

/**
 * The line a thinking block is on: its last one, which is what it is thinking now. While it streams, its last
 * line is usually still being written and reads as a fragment (`- The tot`), so a streaming block shows its
 * last complete line instead, and before it has one, the words written so far without the one being written.
 * A script written without spaces (Chinese, Japanese) has no word to leave out: its text so far is shown. A
 * spaced script's first word alone may still be half-written (`Th`), so it shows nothing yet.
 */
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

/** What kind of work a live run is in, for what follows it without reading its words (the avatar's face). */
export type Activity = "thinking" | "tool" | "answering";

/**
 * What a live run is doing right now, in words, from what the transcript already holds: the tool that
 * is running and its argument, the line the model is thinking, or the answer being written. Before the
 * runtime reports the run, it is still starting, which is thinking, as compacting is.
 */
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

/**
 * History: the three kinds the contract guarantees, in the shape FastAgent's adapter writes them.
 *
 * A tool call and its result arrive apart: the call is announced inside the assistant entry's
 * `toolCalls` (id, name and the arguments `tool_started` carried live), and the result is its own `tool`
 * entry pointing back with `toolCallId`. Rendering them as one row is this function's whole job; anything
 * engine-specific is skipped, as the contract allows.
 *
 * An answer that did not end normally says how (`outcome`), and gets the note a watcher saw live: a
 * failed or stopped answer that ended its run is `run failed: …` or `run stopped`, and a failed one
 * offers its run's message again (`resend`). A failed answer the run went on from (pi's own retry) is
 * only a retry, and in a conversation still `running` the last failure is a retry still waiting.
 *
 * A conversation that is not running but stops partway through a turn (on the person's message, on a
 * tool's result, or on calls that never ran) had its run cut with nothing recorded: duang or the machine
 * stopped mid-run. It says so, and offers that turn's message again, like a failure.
 *
 * A run its last tool batch ended on purpose (pi's `terminate`) stops on a tool's result too, and is not cut:
 * every call answering that answer carries `terminate`, which is FastAgent's reading of it.
 *
 * `running`: a run is going now. A compaction is not one: FastAgent admits it only at a boundary, so a turn
 * cut before it is still cut. A call with no result is interrupted in a finished conversation, but the calls
 * after the last user message are the active run's, still executing. They get no `started`: when they began
 * is not in the history, so they show no clock.
 */
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
  /** A failed answer whose run has not been seen to go on: its note, and the error it gives. */
  let failure: { index: number; message: string } | undefined;
  /**
   * Where the work no answer has concluded yet begins: what a retry could repeat. History does not say where
   * a run began, so this stands in for it; the live view counts from `run_started` instead (`conversation.ts`).
   */
  let unconcluded = 0;
  /** Where the turn stands after the last conversation entry: answered, or cut partway. */
  let open = false;
  /** The calls of the latest answer, and whether each one's result asked to end the run. */
  let batch = new Map<string, boolean>();
  /**
   * A failure the run did not go on from is its ending, which says how it ended: the line counting the
   * retries before it goes. Where the failure now is.
   */
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
      // The reasoning the answer recorded, as it streamed live. How long it took is not recorded.
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
      // An answer that called no tool ends its work: a later failure cannot repeat what came before it. One
      // that did waits for its calls' results and the answer after them; one with an outcome said how it ended.
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
      // Every call of the answer asked to end the run: it ended here, on purpose, and its work is done.
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

/** An answer that reached the model's output limit, from history or live: it is not all there. */
const TRUNCATED = "answer cut off at the model's output limit";

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
 * still going is what the agent is doing now, so it quotes the line it is on; settled, thinking is not
 * output and is passed over, like an answer with no text yet. While calls run, the newest still running
 * is quoted, not one started after it that already finished (`ls` beside a running `sleep`). Markdown
 * loses only the marks that would show up as noise in two lines of plain text.
 */
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

/**
 * Thinking ends when the model starts doing something else — answering or calling a tool — not
 * when the whole message settles. The message can go on for minutes after its thinking stopped, and
 * the block's `at` is what `thinking · Ns` is measured to.
 */
function stopThinking(items: Item[], at: number): Item[] {
  return items.map((item) => (item.kind === "thinking" && item.open ? { ...item, open: false, at } : item));
}

/**
 * The events this app reads, by the contract's own types. The one cast is here: a stream of
 * `SessionEvent` is narrowed by its `type`, so a field the contract renames fails to compile rather
 * than reading as `undefined` at run time. Types outside the union reach `default` untouched.
 */
type ReadEvent = KnownSessionEvent | ServingErrorEvent;
export const known = (event: SessionEvent) => event as ReadEvent;

/**
 * One live event applied to the list. Returns a new list; unknown event types change nothing. Every item the event
 * does not change stays the same object: the transcript skips redrawing such a line (`SettledMessage`), so a new
 * object for an unchanged item redraws the whole conversation on every streamed word.
 */
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
      // Stamped on settling, not on the first delta: an answer that streamed for five minutes would
      // otherwise show one time live and another after a reopen, where history carries the time
      // FastAgent wrote the entry. Only what is still open settles here — restamping an item that
      // already settled moves the time under an older answer, and stretches `thinking · Ns` to
      // the end of every later message.
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
      // An aborted run carries the abort machinery's own words ("This operation was aborted",
      // "Request aborted"). The person pressed Stop; that is the whole explanation. Only a FAILED
      // run has a reason they could not already know, so only that one keeps its message.
      const error = stopped ? undefined : e.data.error;
      return [
        ...items,
        {
          kind: "note",
          at: event.timestamp,
          tone: stopped ? "info" : "error",
          // One vocabulary (§9): a run the person ended is `stopped`, never the abort machinery's
          // `aborted`, and never `failed` — that word blames the run for their decision.
          text: `run ${stopped ? "stopped" : e.data.status}${error?.message ? `: ${error.message}` : ""}`,
          ...(stopped ? {} : failed(error?.message ?? "")),
        },
      ];
    }
    case "retry_scheduled":
      // The run goes on: pi tries again by itself, so this is a quiet line, not a failure. If the retries give
      // up, the run's own ending says so.
      // One line that moves on with each attempt, rather than one per attempt.
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
