/**
 * One conversation as this window holds it: what the runtime said (its history, then its live events) and the
 * messages this window sent that have not entered yet. The store decides which conversations are held and talks
 * to main; this module decides how one changes. Changed in place: the store tells a conversation that was closed
 * or reopened from the current one by identity.
 */
import type { SessionEntries, SessionEvent, SessionState } from "@fastagent-sh/fastagent/session";
import { apply, claim, fromEntries, known, opensRun, queueView, wentOn, type Item, type UserItem } from "./transcript.ts";

/** A problem said over the pane: what it means, what to do, and the original words. */
export interface Trouble {
  title: string;
  advice?: string;
  reason: string;
}

export interface Conversation {
  agentId: string;
  session: string;
  subscription: string;
  items: Item[];
  state?: SessionState;
  draft: string;
  loading: boolean;
  /** This view could not open the conversation, or lost its subscription: said over it, with Reconnect. */
  error?: Trouble;
  /** Main ended this subscription on purpose. Nothing broke; this view just stopped listening. */
  ended?: string;
  sends: number;
  /** Live events that arrived while the history was being read, applied once it is. */
  events: SessionEvent[];
  /**
   * Messages sent from this window that have not entered the conversation yet, oldest first. They
   * show below the live output until the runtime's `user_message` places them: a steer is read at the
   * run's next turn boundary, so placing it at send time put it above output written without it.
   */
  waiting: UserItem[];
  /** Of `waiting`, those whose send already returned: accepted, yet nothing has entered from them. */
  returned: Set<UserItem>;
  /** The current run already has a user message, so the next one joined it rather than opened it. */
  runHasUser: boolean;
  /** When this window saw the current run start; unknown for a run that was already going when it opened. */
  started?: number;
  /** When this window last heard anything of the conversation's run (or sent into it): how long it has been quiet. */
  heard?: number;
  /**
   * The current run as this window heard it from its `run_started`: the last message that entered it and
   * whether it started a tool. Absent for a run joined midway, whose history does not say where it began.
   */
  run?: { message?: string; toolsRan: boolean };
}

/** How a run this window heard end ended. */
export type Settled = "completed" | "failed" | "aborted";

/**
 * Events that report what the person did (a message queued or entered, a setting changed), not output from
 * the run: they do not end the model's silence.
 */
const PERSON_SIDE = new Set(["queue_changed", "user_message", "state_changed"]);

export function createConversation(agentId: string, session: string, draft: string): Conversation {
  return {
    agentId,
    session,
    subscription: crypto.randomUUID(),
    items: [],
    draft,
    loading: true,
    sends: 0,
    events: [],
    waiting: [],
    returned: new Set(),
    runHasUser: false,
  };
}

/** Two facts decide it: what we have in flight locally, and what the runtime says it is doing. */
export const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

/**
 * The history read when the conversation opened, then the live events that arrived while it was read.
 * Sends are refused until this lands. An already-running local turn retains its subscription and view
 * across navigation, so its deltas are never reconstructed from history. Returns how the runs those
 * events ended did.
 */
export function backfill(c: Conversation, opened: { entries: SessionEntries; state: SessionState }, now: number): Settled[] {
  const { entries, state } = opened;
  c.items = fromEntries(entries.entries, entries.leafEntryId, state.status === "running");
  c.state = state;
  // Opened mid-run, the run's opening message is already in the history just read; its silence counts from now.
  c.runHasUser = state.status === "running";
  if (c.runHasUser) c.heard = now;
  c.loading = false;
  const settled = c.events.flatMap((event) => fold(c, event, now) ?? []);
  c.events = [];
  return settled;
}

/** One live event. Returns how the run ended, when the event is its end. */
export function receive(c: Conversation, event: SessionEvent, now: number): Settled | undefined {
  if (!PERSON_SIDE.has(event.type)) c.heard = now;
  if (c.loading) {
    c.events.push(event);
    return undefined;
  }
  return fold(c, event, now);
}

function fold(c: Conversation, event: SessionEvent, now: number): Settled | undefined {
  const state = c.state ?? { status: "idle", pending: { steering: [], followUp: [] } };
  const e = known(event);
  const run = c.run;
  if (e.type === "run_started") {
    c.runHasUser = false;
    c.started = e.timestamp;
    c.run = { toolsRan: false };
    c.state = { ...state, status: "running", activeRunId: e.runId };
  } else if (e.type === "run_settled") {
    dropQueued(c, state.pending.steering);
    c.started = undefined;
    c.run = undefined;
    c.state = { ...state, status: "idle", activeRunId: undefined, pending: { steering: [], followUp: [] } };
  } else if (e.type === "user_message") {
    enter(c, e.data.entryId, e.data.text, e.timestamp);
  } else if (e.type === "tool_started") {
    if (c.run) c.run.toolsRan = true;
  } else if (e.type === "queue_changed") {
    c.state = { ...state, pending: e.data };
  } else if (e.type === "state_changed") {
    c.state = { ...state, ...e.data };
  }
  c.items = apply(c.items, event);
  // A run heard from its start that failed after taking a message offers that message again. One that
  // failed before (no credential, say) already returned the text to the draft. A run joined midway does not
  // know its start here; reopened, its history does.
  const failure = c.items.at(-1);
  if (e.type === "run_settled" && e.data.status === "failed" && run?.message !== undefined && failure?.kind === "note")
    c.items = [...c.items.slice(0, -1), { ...failure, resend: { text: run.message, toolsRan: run.toolsRan } }];
  if (e.type !== "run_settled") return undefined;
  ranNothing(c, now);
  return e.data.status;
}

/**
 * The runtime placed a user message: it goes into the transcript here, at the moment it entered.
 * An entry the history already holds (a backfill that overlapped the live stream) is not added
 * twice. This window's own message keeps the words that were typed.
 */
function enter(c: Conversation, entryId: string, text: string, at: number) {
  const known = c.items.some((item) => item.kind === "user" && item.entryId === entryId);
  const own = known ? undefined : claim(c.waiting, text);
  if (own) {
    c.waiting = c.waiting.filter((item) => item !== own);
    c.returned.delete(own);
  }
  // A steer typed while pi waited out a retry enters as the next attempt starts: the wait is over.
  if (!known) c.items = [...wentOn(c.items), { kind: "user", text: own?.text ?? text, at, steered: c.runHasUser, entryId }];
  c.runHasUser = true;
  // The message the run is answering now; a steer replaces the opening one. What was typed, if it was ours.
  if (c.run) c.run.message = own?.text ?? text;
}

/**
 * What the runtime still lists as queued when its run ends never entered the conversation and is
 * dropped with the run. It returns to the draft rather than stay on screen as if delivered, and so
 * does a message this window did not send: after a reload the runtime's queue is the only place a
 * steer typed before it still exists, and nothing else would keep those words.
 */
function dropQueued(c: Conversation, pending: string[]) {
  const dropped = queueView(c.waiting, pending).flatMap(({ item, listed }) => (listed ? [item] : []));
  if (!dropped.length) return;
  c.waiting = c.waiting.filter((item) => !dropped.includes(item));
  for (const item of dropped) c.returned.delete(item);
  c.draft = [...dropped.map((item) => item.text), c.draft].filter(Boolean).join("\n");
}

/**
 * An accepted message with no run left to enter: an extension command that did its work without
 * sending anything into the conversation. It ran, so it neither returns to the draft nor vanishes.
 */
function ranNothing(c: Conversation, now: number) {
  const ran = c.waiting.filter((item) => c.returned.has(item));
  if (!ran.length) return;
  c.waiting = c.waiting.filter((item) => !c.returned.has(item));
  c.returned.clear();
  c.items = [...c.items, ...ran.map((item): Item => ({ kind: "note", tone: "info", text: `ran ${item.text}`, at: now }))];
}

/**
 * A message sent from here, before main answers. Where it goes is the runtime's report, not this guess: it
 * waits below the output until `user_message` places it, whether it opens a run or joins one.
 */
export function sent(c: Conversation, text: string, now: number): UserItem {
  const echo: UserItem = { kind: "user", text, at: now, opens: opensRun(c.state?.status, c.runHasUser) };
  // A new run's silence counts from its message; a steer is the person, not the model, and leaves it be.
  if (echo.opens) c.heard = now;
  c.waiting = [...c.waiting, echo];
  return echo;
}

/** Main refused it and nothing entered from it, so the text is the person's to send again. */
export function unsent(c: Conversation, echo: UserItem): void {
  c.waiting = c.waiting.filter((item) => item !== echo);
  c.draft = c.draft ? `${echo.text}\n${c.draft}` : echo.text;
}

/**
 * Main accepted it. A run that already ended while the call returned has nothing left to place it with.
 * A stream that ended cannot say whether it entered: Retry re-reads the history instead.
 */
export function accepted(c: Conversation, echo: UserItem, now: number): void {
  c.returned.add(echo);
  if (c.state?.status !== "running" && !c.ended && !c.error) ranNothing(c, now);
}

/** This view stopped hearing the conversation: main let it go, ended it, or listening failed. */
export function lost(c: Conversation, ending: { reason: string; why: "let_go" | "ended" | "failed" }, now: number): void {
  // Nothing will report the end of a run this view can no longer hear, so stop waiting for one.
  // Retry re-opens and re-reads the runtime's real state.
  if (c.state) c.state = { ...c.state, status: "idle", activeRunId: undefined };
  // A tool's clock is a claim that it is still being watched. It stops where this view stopped
  // hearing; how long the tool really ran is no longer knowable here.
  c.items = c.items.map((item) =>
    item.kind === "tool" && item.status === "running" && item.ended === undefined ? { ...item, ended: now } : item,
  );
  if (ending.why !== "failed") c.ended = ending.reason;
  else
    c.error = {
      title: "The live connection to this conversation was lost",
      advice: "A run in it goes on in duang. Reconnect to see where it is now.",
      reason: ending.reason,
    };
}
