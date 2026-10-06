// Changed in place: the store tells a closed or reopened conversation from the current one by identity.
import type { SessionEntries, SessionEvent, SessionState } from "@fastagent-sh/fastagent/session";
import { apply, claim, fromEntries, known, opensRun, queueView, wentOn, type Item, type UserItem } from "./transcript.ts";

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
  error?: Trouble;
  ended?: string;
  sends: number;
  events: SessionEvent[];
  // Shown below the live output until `user_message` places them: a steer is read at the next turn boundary.
  waiting: UserItem[];
  returned: Set<UserItem>;
  runHasUser: boolean;
  started?: number;
  heard?: number;
  run?: { message?: string; toolsRan: boolean };
}

export type Settled = "completed" | "failed" | "aborted";

// What the person did, not run output: these do not end the model's silence.
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

export const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

// A running local turn keeps its subscription across navigation, so its deltas never come from history.
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
  // A run heard from its start that failed after taking a message offers it again. `toolsRan` counts every tool
  // since `run_started`; history cannot, so live and reopened answers may differ (docs/interaction.md).
  const failure = c.items.at(-1);
  if (e.type === "run_settled" && e.data.status === "failed" && run?.message !== undefined && failure?.kind === "note")
    c.items = [...c.items.slice(0, -1), { ...failure, resend: { text: run.message, toolsRan: run.toolsRan } }];
  if (e.type !== "run_settled") return undefined;
  ranNothing(c, now);
  return e.data.status;
}

// An entry the history already holds (backfill overlapping the live stream) is not added twice.
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

// What is still queued when the run ends never entered; it returns to the draft. After a reload the runtime's
// queue is the only place such a steer still exists, so this includes messages this window did not send.
function dropQueued(c: Conversation, pending: string[]) {
  const dropped = queueView(c.waiting, pending).flatMap(({ item, listed }) => (listed ? [item] : []));
  if (!dropped.length) return;
  c.waiting = c.waiting.filter((item) => !dropped.includes(item));
  for (const item of dropped) c.returned.delete(item);
  c.draft = [...dropped.map((item) => item.text), c.draft].filter(Boolean).join("\n");
}

// An extension command that did its work without sending anything: it ran, so it neither returns nor vanishes.
function ranNothing(c: Conversation, now: number) {
  const ran = c.waiting.filter((item) => c.returned.has(item));
  if (!ran.length) return;
  c.waiting = c.waiting.filter((item) => !c.returned.has(item));
  c.returned.clear();
  c.items = [...c.items, ...ran.map((item): Item => ({ kind: "note", tone: "info", text: `ran ${item.text}`, at: now }))];
}

// Where it goes is the runtime's report: it waits below the output until `user_message` places it.
export function sent(c: Conversation, text: string, now: number): UserItem {
  const echo: UserItem = { kind: "user", text, at: now, opens: opensRun(c.state?.status, c.runHasUser) };
  // A new run's silence counts from its message; a steer is the person, not the model, and leaves it be.
  if (echo.opens) c.heard = now;
  c.waiting = [...c.waiting, echo];
  return echo;
}

export function unsent(c: Conversation, echo: UserItem): void {
  c.waiting = c.waiting.filter((item) => item !== echo);
  c.draft = c.draft ? `${echo.text}\n${c.draft}` : echo.text;
}

// A stream that ended cannot say whether it entered: Retry re-reads the history.
export function accepted(c: Conversation, echo: UserItem, now: number): void {
  c.returned.add(echo);
  if (c.state?.status !== "running" && !c.ended && !c.error) ranNothing(c, now);
}

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
