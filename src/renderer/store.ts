import {
  NO_ACTIVE_RUN_CODE,
  type AgentCommand,
  type SessionEvent,
  type SessionState,
  type SessionSummary,
} from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, Models, ProviderUsage, SessionFrame } from "../preload/index.ts";
import {
  apply,
  claim,
  fromEntries,
  known,
  opensRun,
  phase,
  previewOf,
  queueView,
  type Activity,
  type Item,
  type UserItem,
} from "./transcript.ts";
import { message } from "./message.ts";
import type { Fix } from "./problems.ts";
/** main's code for a send refused because the conversation's model cannot run here (`send.ts`). */
const MODEL_UNAVAILABLE_CODE = "model_unavailable";
/**
 * Events that report what the person did (a message queued or entered, a setting changed), not output from
 * the run: they do not end the model's silence.
 */
const PERSON_SIDE = new Set(["queue_changed", "user_message", "state_changed"]);
/** A conversation that loses its subscription again within this long of reconnecting by itself waits for the person. */
const RECONNECT_GAP_MS = 30_000;
import { createSettings, type SettingsView } from "./settings-store.ts";

export type AgentState = "ready" | "missing_model" | "no_agent" | "missing_dir" | "broken";
/** A problem said over the pane: what it means, what to do, and the original words. */
export interface Trouble {
  title: string;
  advice?: string;
  reason: string;
}
/**
 * What the main pane shows, one of these at a time. `settling` is an agent still opening, or a conversation
 * (or an agent with some) whose history has not arrived: the new-conversation page there would be a flash
 * of the wrong screen.
 * `start` is that page, for a new conversation or an agent with no model yet.
 */
export type Pane =
  | "unreadable-registry"
  | "no-agents"
  | "broken"
  | "no-agent"
  | "missing-dir"
  | "settling"
  | "start"
  | "transcript";
/**
 * Where the window was last left. Navigation, not conversation data: the transcript belongs to the
 * runtime, and losing this only costs one click. So it is stored as best effort and never repaired
 * — anything unreadable is simply a first start.
 */
const SELECTION_KEY = "duang.selection";
const DRAFTS_KEY = "duang.drafts";
/** Where an unreadable drafts value is moved, so the next write does not replace the person's text. */
const UNREADABLE_DRAFTS_KEY = "duang.drafts.unreadable";
interface Selection {
  agentId?: string;
  perAgent: [string, string][];
  /**
   * The new conversation a fresh start (after repeated crashes) opened. Left as the selection, it is
   * returned to like a conversation with a record, so a reload or restart does not fall back to the newest
   * one, which is likely the conversation that crashed the window.
   */
  fresh?: string;
}
/**
 * Unsent text, kept until it is sent, cleared, or its conversation or agent goes away. Unlike the
 * selection it is the person's own words: a value that cannot be read is moved aside and reported,
 * not dropped, because the first write after this would otherwise replace it for good.
 */
function readDrafts(): [string, string][] {
  let stored: string | null | undefined;
  try {
    stored = globalThis.localStorage?.getItem(DRAFTS_KEY);
  } catch {
    // Storage that cannot be read at all (disabled) has nothing to lose, only nothing to restore.
    return [];
  }
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    const pair = (entry: unknown) =>
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string";
    if (Array.isArray(parsed) && parsed.every(pair)) return parsed as [string, string][];
    throw new Error("expected a list of [conversation, text] pairs");
  } catch (error) {
    writeStored(UNREADABLE_DRAFTS_KEY, stored);
    console.error(`duang: unreadable drafts moved to ${UNREADABLE_DRAFTS_KEY}:`, error);
    return [];
  }
}
function readSelection(): Selection | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(SELECTION_KEY);
    const parsed = stored ? (JSON.parse(stored) as Selection) : undefined;
    return parsed && Array.isArray(parsed.perAgent) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
function writeStored(storageKey: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(storageKey, value);
  } catch {
    // A full or disabled store costs a click or a retyped line after the next restart, nothing else.
  }
}
interface Conversation {
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
/**
 * What an agent's roster row quotes: the newest output of the conversation it speaks for. Live while
 * this window holds that conversation, read once from its history otherwise. Presentation only: it
 * is never written anywhere, and the transcript stays the runtime's.
 */
export interface Preview {
  session: string;
  text?: string;
  at?: number;
  /** The history could not be read; the row says so rather than quoting something older. */
  error?: string;
}
export interface View extends SettingsView {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  /** Conversations per agent: every roster row shows its agent's latest one. */
  sessions: Record<string, SessionSummary[]>;
  /** Why an agent has no list, per agent. An empty list and a failed one are not the same. */
  sessionsError: Record<string, string>;
  model?: string;
  /** The agent list, or the agent selected, is being opened. */
  loading: boolean;
  /** The agent whose model the picker is setting up; its conversation stays on screen meanwhile. */
  changingModel?: string;
  /** About the open agent, or a failure with no conversation to note it in. */
  error?: string;
  /** The open agent failed to load in its config, which a fresh one would get past. */
  errorInConfig?: true;
  /**
   * An action that belongs to no conversation failed (renaming, adding, revealing or removing an agent):
   * said above the pane until dismissed, never written into whichever conversation is open.
   */
  failure?: { title: string; reason: string };
  /** Why duang's own agent list could not be read. Not an empty list: the pane says so. */
  registryError?: string;
  /** The model picker's contents: undefined while loading, so the picker can say so. */
  models?: Models;
  modelsError?: string;
  /** What the picker's last "refresh models" is doing or said; cleared whenever the list is read again. */
  modelsRefresh?: { status: "running" } | { status: "done"; added: number } | { status: "failed"; error: string };
  /** The `/` completion list for the selected agent. */
  commands: AgentCommand[];
  commandsError?: string;
  conversation?: Conversation;
  /** The open conversation has a turn in flight. Subscription retention and the run controls read this. */
  busy: boolean;
  /** What the main pane shows, derived once from everything above (`paneOf`). */
  pane: Pane;
  /** The failure said over the pane, with its Retry; none when the pane itself explains it. */
  alert?: Trouble;
  /**
   * Why the composer cannot send, in the words the person should read, or undefined when it can.
   * One rule, derived once: the placeholder shows it and `send` treats reaching it as a bug.
   */
  blocked?: string;
  /**
   * The open conversation ends on a turn that failed or was cut short, and its message can be sent again now
   * (`resend`): that turn's note says what, whether this window heard the run live or read it back from history. Not the same
   * as `retry`, which reopens a conversation whose view broke.
   */
  resend?: { text: string; toolsRan: boolean };
  /**
   * A send was refused because the conversation's model cannot run here (its provider is not connected, or
   * it is not offered). The composer opens the picker on it, saying why; `asked` makes each refusal a new
   * request. Cleared once a model is chosen, or the person goes to another conversation.
   */
  unavailable?: { agentId: string; session: string; model: string; asked: number };
  /** Conversations with a turn in flight, per agent: the sidebar asks this of every agent it lists. */
  running: Record<string, string[]>;
  /** Per agent with a turn in flight, the kind of work it is in (`phase`): its avatar's face follows it. */
  doing: Record<string, Activity>;
  /** Conversations holding unsent text, per agent, so a draft never becomes unreachable. */
  unsent: Record<string, string[]>;
  /**
   * Outcomes that landed while the person was not looking at that conversation, per agent. Fact 4:
   * runs are long and you come back to them, so "what happened while I was away" is the sidebar's
   * job. Opening the conversation clears it — like an unread mark, it exists to be spent.
   */
  unseen: Record<string, Record<string, "done" | "failed">>;
  /** Plan windows per provider: the last answer, or why there is none. Main decides how often to ask. */
  usage: Record<string, { data?: ProviderUsage; error?: string }>;
  /** Per agent, what its roster row quotes. */
  previews: Record<string, Preview>;
}
/** [agentId, session] pairs into one list per agent. */
const group = (pairs: [string, string][]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [agentId, session] of pairs) (out[agentId] ??= []).push(session);
  return out;
};

/** Two facts decide it: what we have in flight locally, and what the runtime says it is doing. */
const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

/**
 * The pane, the alert above it and why the composer cannot send are one decision about the same facts,
 * made here and nowhere else: the screens read the answer.
 */
function paneOf(view: View): Pane {
  const { agentId, conversation: c } = view;
  if (!agentId) return view.registryError ? "unreadable-registry" : "no-agents";
  const state = view.states[agentId];
  if (state === "broken") return "broken";
  if (state === "no_agent") return "no-agent";
  if (state === "missing_dir") return "missing-dir";
  // Not known yet: the agent is still opening (at launch, or the first time it is chosen), and may well
  // have conversations to show.
  if (state === undefined) return "settling";
  if (state !== "ready") return "start";
  const sessions = view.sessions[agentId] ?? [];
  // A ready agent with no conversation open is about to open one: its newest, if it has any.
  if (c ? c.loading && sessions.some((s) => s.session === c.session) : sessions.length > 0) return "settling";
  const shown = c && (c.items.length > 0 || queueView(c.waiting, c.state?.pending.steering ?? []).length > 0);
  return shown ? "transcript" : "start";
}
function alertOf(view: View): Trouble | undefined {
  const c = view.conversation;
  if (c?.error) return c.error;
  // No agent: an unreadable list is its own page, which says why.
  if (!view.agentId || !view.error) return undefined;
  // A setup problem's own panel explains it and offers the fix. The runtime's prose above it would
  // contradict that: a plain project is told to run `fastagent init` while duang offers to scaffold it.
  const state = view.states[view.agentId];
  if (state === "broken" || state === "missing_model" || state === "no_agent" || state === "missing_dir") return undefined;
  return { title: "This agent could not be opened", advice: "Try again; its folder and conversations are untouched.", reason: view.error };
}
/** In the order the person should hear it: the nearest reason first, the agent's setup after. */
function blockedBy(view: View): string | undefined {
  const c = view.conversation;
  const state = view.agentId ? view.states[view.agentId] : undefined;
  if (view.loading || c?.loading) return "opening conversation…";
  if (view.agentId && view.changingModel === view.agentId) return "changing the model…";
  if (c?.error || c?.ended) return "reconnect before sending";
  if (state === "broken") return "this agent is broken";
  if (state === "no_agent") return "create an agent here first";
  if (state === "missing_dir") return "this agent's folder is missing";
  if (state === "missing_model") return "pick a model to start";
  if (!c) return "no conversation";
  return state === "ready" ? undefined : "this agent is not ready";
}

/** Runtime data stays in the runtime; this store owns selection, drafts and live, not-yet-durable output. */
export function createStore(api: DuangApi) {
  let view: View = {
    agents: [],
    states: {},
    sessions: {},
    sessionsError: {},
    loading: false,
    busy: false,
    pane: "no-agents",
    commands: [],
    avatar: "gaze",
    running: {},
    doing: {},
    unsent: {},
    unseen: {},
    usage: {},
    previews: {},
  };
  const listeners = new Set<() => void>();
  const conversations = new Map<string, Conversation>();
  const drafts = new Map<string, string>(readDrafts());
  /**
   * Where each conversation was left scrolled, only while it was above the latest line: a conversation
   * closes when it is left and its view unmounts (Settings, another agent), and what the person was
   * reading is where they expect to come back to. Presentation only, kept for the window's life.
   */
  const scrolls = new Map<string, number>();
  let persisted = "";
  /** Where each agent was left, so returning to it is not the same as opening it for the first time. */
  const stored = readSelection();
  const lastOpened = new Map<string, string>(stored?.perAgent);
  /**
   * What finished while you were elsewhere, keyed `agentId/session`. In memory on purpose: it is a
   * fact about this window's attention, not about the conversation, and the transcript stays the
   * only durable record of what happened.
   */
  const unseen = new Map<string, "done" | "failed">();
  let lastAgent = stored?.agentId;
  let freshSession = stored?.fresh;
  let navigation = 0;
  /**
   * One request number per agent: taking one makes the answers to every earlier one stale, so a slow
   * answer never overwrites a newer one. Returns whether this request is still the newest.
   */
  const tickets = () => {
    const latest = new Map<string, number>();
    return (id: string) => {
      const request = (latest.get(id) ?? 0) + 1;
      latest.set(id, request);
      return () => latest.get(id) === request;
    };
  };
  /** Taken by every read that writes an agent's conversation list: opening the agent and re-reading it. */
  const listTicket = tickets();
  /** Taken by every read of the history an agent's row quotes. */
  const previewTicket = tickets();
  let modelsRequest = 0;
  /**
   * Previews by agent, with the list's `updatedAt` a read was taken at: a history read again only
   * when the conversation moved on or the row now speaks for another one.
   */
  const previews = new Map<string, Preview & { updatedAt?: number }>();
  let commandsFor: string | undefined;
  const key = (agentId: string, session: string) => `${agentId}/${session}`;
  /**
   * The conversation an agent's row speaks for: the one on screen, else the one it was left on, else
   * its newest — the order `selectAgent` reopens it in, so the row quotes what a click would show.
   */
  const selectedSession = (id: string): string | undefined => {
    if (view.conversation?.agentId === id) return view.conversation.session;
    const list = view.sessions[id] ?? [];
    const left = lastOpened.get(id);
    if (left && (list.some((s) => s.session === left) || conversations.has(key(id, left)))) return left;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.session;
  };
  const publish = (patch: Partial<View> = {}) => {
    view = { ...view, ...patch };
    // A conversation this window holds is live, so its row quotes it as it streams. Read before the
    // loop below releases anything: the last event of a settled run is what the row should keep.
    for (const c of conversations.values())
      if (!c.loading && selectedSession(c.agentId) === c.session)
        previews.set(c.agentId, { session: c.session, ...previewOf(c.items) });
    // A quote from a conversation the row no longer speaks for (deleted, or left for another) is
    // dropped rather than shown as current; `readPreview` fetches the right one.
    for (const [id, preview] of previews) if (selectedSession(id) !== preview.session) previews.delete(id);
    view.previews = Object.fromEntries([...previews].map(([id, { updatedAt: _read, ...preview }]) => [id, preview]));
    // How long a view keeps its subscription is decided here, where every way a turn can end passes,
    // so no ending path has to remember. A conversation nobody is looking at is retained only while
    // it can still produce something this view needs: its own backfill, or a turn in flight.
    for (const c of conversations.values()) if (!busy(c) && c !== view.conversation && !c.loading) close(c);
    const running = [...conversations.values()].filter(busy);
    view.busy = !!view.conversation && busy(view.conversation);
    view.running = group(running.map((c) => [c.agentId, c.session]));
    view.doing = Object.fromEntries(running.map((c) => [c.agentId, phase(c.items, c.state?.status).activity]));
    // A conversation the runtime has never heard of exists only while it is on screen. Without a row
    // of its own, walking away from unsent text is the same as discarding it. The open conversation
    // holds its own draft, so read both here: this is the single view of what is unsent.
    const unsent = new Map(drafts);
    if (view.conversation) unsent.set(key(view.conversation.agentId, view.conversation.session), view.conversation.draft);
    view.unseen = {};
    for (const [id, outcome] of unseen) {
      const agentId = id.slice(0, id.indexOf("/"));
      (view.unseen[agentId] ??= {})[id.slice(id.indexOf("/") + 1)] = outcome;
    }
    const kept = [...unsent].filter(([, text]) => text.trim());
    view.unsent = group(kept.map(([id]) => [id.slice(0, id.indexOf("/")), id.slice(id.indexOf("/") + 1)]));
    const serialized = JSON.stringify(kept);
    if (serialized !== persisted) {
      persisted = serialized;
      writeStored(DRAFTS_KEY, serialized);
    }
    view.pane = paneOf(view);
    view.alert = alertOf(view);
    view.blocked = blockedBy(view);
    const open = view.conversation;
    // Anything after the failure (a newer turn, a stop) leaves nothing to send again.
    const last = open?.items.at(-1);
    view.resend = !view.busy && !view.blocked && last?.kind === "note" ? last.resend : undefined;
    for (const listener of listeners) listener();
  };
  /**
   * A problem in a conversation, in the transcript it belongs to: what it means for the person (`title`,
   * `advice`) in front of main's or the runtime's own words, kept verbatim. `warning` is a refusal: it
   * never ran (§9), so the text is still the person's to edit, while a failure has already had effects.
   */
  const note = (
    c: Conversation | undefined,
    problem: { error: unknown; title: string; tone?: "warning" | "error"; advice?: string; fix?: Fix },
  ) => {
    const reason = message(problem.error);
    if (!c) return fail(problem.title, problem.error);
    const { error: _error, tone = "error", ...said } = problem;
    c.items = [...c.items, { kind: "note", tone, text: reason, reason, ...said, at: Date.now() }];
    publish();
  };
  /** A failed action that belongs to no conversation, said above the pane by what it was. */
  const fail = (title: string, error: unknown) => publish({ failure: { title, reason: message(error) } });
  /**
   * About one conversation that may not be the open one (renaming or deleting it from the list): in its
   * transcript when this window holds it, else above the pane by what it was. Never on its agent's row,
   * which says that the list could not be read: a refused delete is not that.
   */
  const reportOn = (agentId: string, session: string, title: string, error: unknown, tone: "warning" | "error") => {
    const held = conversations.get(key(agentId, session));
    if (held) note(held, { error, title, tone });
    else fail(title, error);
  };
  const close = (c: Conversation) => {
    drafts.set(key(c.agentId, c.session), c.draft);
    if (conversations.get(key(c.agentId, c.session)) === c) conversations.delete(key(c.agentId, c.session));
    void api.closeSession(c.subscription).catch((error) => fail("A conversation was not released", error));
  };
  const leave = () => publish({ conversation: undefined });
  const { onStep, ...settings } = createSettings(api, () => view, publish);

  /**
   * Re-reads one agent's conversations, the open agent's included. A failure lands on that agent's
   * row, where the sidebar and the conversation list both say it: an empty list and a list that
   * could not be read are not the same answer.
   */
  async function listSessions(id: string) {
    const current = listTicket(id);
    const settle = (patch: Partial<View>) => {
      if (current()) publish(patch);
    };
    // Another agent's row says its setup in words, so the answer's state is kept for it. Never the
    // open agent's: `states` drives the main panel, and `selectAgent` owns that one. The open
    // agent's model is what the composer shows, so the answer refreshes it.
    const own = (value: AgentState, model?: string) =>
      id === view.agentId ? (model ? { model } : {}) : { states: { ...view.states, [id]: value } };
    try {
      const result = await api.openAgent(id);
      if (!result.ok)
        return settle({
          sessionsError: { ...view.sessionsError, [id]: result.message },
          ...own(result.code === "failed" ? "broken" : result.code),
        });
      const { [id]: _cleared, ...errors } = view.sessionsError;
      settle({ sessions: { ...view.sessions, [id]: result.sessions }, sessionsError: errors, ...own("ready", result.model) });
      if (current()) await readPreview(id);
    } catch (error) {
      settle({ sessionsError: { ...view.sessionsError, [id]: message(error) } });
    }
  }

  /** Quotes the conversation an agent's row speaks for when this window does not hold it. */
  async function readPreview(id: string) {
    const session = selectedSession(id);
    if (!session || conversations.has(key(id, session))) return;
    const updatedAt = view.sessions[id]?.find((s) => s.session === session)?.updatedAt;
    const known = previews.get(id);
    if (known?.session === session && known.updatedAt === updatedAt && !known.error) return;
    const current = previewTicket(id);
    let preview: Preview;
    try {
      // The state too: a run still going (after a reload, say) has not been cut short. A compaction is not a
      // run (FastAgent admits one only at a boundary), so a turn cut before it is still cut.
      const [history, state] = await Promise.all([api.readSession(id, session), api.readState(id, session)]);
      preview = { session, ...previewOf(fromEntries(history.entries, history.leafEntryId, state.status === "running")) };
    } catch (error) {
      preview = { session, error: message(error) };
    }
    // Only the newest read lands. A conversation opened meanwhile, or a row that moved on to another,
    // needs nothing here: `publish` quotes the live one first and drops a quote that is not selected.
    if (!current()) return;
    previews.set(id, { ...preview, updatedAt });
    publish();
  }

  async function open(session: string) {
    const agentId = view.agentId;
    if (!agentId) return;
    // Already on screen: clearing the view to show the same conversation again would rebuild it, and lose
    // the place being read. (A conversation that was closed, as a retry does, is not on screen.)
    const open = view.conversation;
    if (open?.agentId === agentId && open.session === session && conversations.get(key(agentId, session)) === open) return;
    // Looking at it is what spends the mark.
    unseen.delete(key(agentId, session));
    lastOpened.set(agentId, session);
    lastAgent = agentId;
    // Kept only while it is still where some agent was left.
    if (freshSession && ![...lastOpened.values()].includes(freshSession)) freshSession = undefined;
    writeStored(
      SELECTION_KEY,
      JSON.stringify({ agentId, perAgent: [...lastOpened], ...(freshSession && { fresh: freshSession }) } satisfies Selection),
    );
    // No `leave()` first: clearing the view to put another conversation in it renders the screen for "no
    // conversation" in between. Publishing the next one is what makes the previous one stop being current.
    const existing = conversations.get(key(agentId, session));
    if (existing) {
      publish({ conversation: existing, error: undefined, unavailable: undefined });
      return;
    }
    const c: Conversation = {
      agentId,
      session,
      subscription: crypto.randomUUID(),
      items: [],
      draft: drafts.get(key(agentId, session)) ?? "",
      loading: true,
      sends: 0,
      events: [],
      waiting: [],
      returned: new Set(),
      runHasUser: false,
    };
    conversations.set(key(agentId, session), c);
    publish({ conversation: c, error: undefined, unavailable: undefined });
    try {
      const result = await api.openSession(agentId, session, c.subscription);
      if (conversations.get(key(agentId, session)) !== c) return;
      c.items = fromEntries(result.entries.entries, result.entries.leafEntryId, result.state.status === "running");
      c.state = result.state;
      // Opened mid-run, the run's opening message is already in the history just read; its silence counts from now.
      c.runHasUser = result.state.status === "running";
      if (c.runHasUser) c.heard = Date.now();
      c.loading = false;
      // New sends are disabled until backfill finishes. An already-running local turn retains its
      // subscription and view across navigation, so its deltas are never reconstructed from history.
      for (const event of c.events) fold(c, event);
      c.events = [];
      publish();
    } catch (error) {
      if (conversations.get(key(agentId, session)) !== c) return;
      c.loading = false;
      c.error = {
        title: "This conversation could not be opened",
        advice: "Its history is untouched. Try again, or choose another conversation.",
        reason: message(error),
      };
      publish();
    }
  }

  /** One message into the conversation, from the draft or from Retry. A refused one returns to the draft. */
  async function submit(c: Conversation, text: string) {
    // Where it goes is the runtime's report, not this guess: it waits below the output until
    // `user_message` places it, whether it opens a run or joins one.
    const echo: UserItem = { kind: "user", text, at: Date.now(), opens: opensRun(c.state?.status, c.runHasUser) };
    // Notes from before this send are not this send's: a refusal said for an earlier message is said again.
    const before = c.items.length;
    // A new run's silence counts from its message; a steer is the person, not the model, and leaves it be.
    if (echo.opens) c.heard = Date.now();
    c.waiting = [...c.waiting, echo];
    const waiting = () => c.waiting.includes(echo);
    /** Nothing entered from it, so the text is still the person's to send again. */
    const restoreRejected = () => {
      c.waiting = c.waiting.filter((item) => item !== echo);
      c.draft = c.draft ? `${text}\n${c.draft}` : text;
    };
    c.sends++;
    publish();
    try {
      const result = await api.send(c.agentId, c.session, text);
      if (!result.ok) {
        // Once it entered, the failure is the run's, and the run's note already says it.
        if (!waiting()) return;
        const model = c.state?.model ?? view.model;
        if (result.error.code === MODEL_UNAVAILABLE_CODE && model) {
          // The way on is choosing a model, so the picker opens on it and says why; nothing goes in the
          // transcript, because nothing happened in the conversation.
          restoreRejected();
          publish({ unavailable: { agentId: c.agentId, session: c.session, model, asked: Date.now() } });
          return;
        }
        if (
          result.error.code !== "aborted" &&
          !c.items.slice(before).some((item) => item.kind === "note" && item.text.includes(result.error.message))
        )
          note(c, { error: result.error.message, tone: "warning", title: "Not sent", advice: "Your message is back in the composer." });
        restoreRejected();
      } else if (waiting()) {
        c.returned.add(echo);
        // A run that already ended while the call returned has nothing left to place it with. A
        // stream that ended cannot say whether it entered: Retry re-reads the history instead.
        if (c.state?.status !== "running" && !c.ended && !c.error) ranNothing(c);
      }
    } catch (error) {
      note(c, { error, title: "The message could not be sent" });
      if (waiting()) restoreRejected();
    } finally {
      c.sends--;
      publish();
    }
  }

  async function selectAgent(id: string, session?: string) {
    const request = ++navigation;
    const listCurrent = listTicket(id);
    const left = view.agentId;
    leave();
    // The agent being left stops being live on screen; its row keeps quoting what it was left on.
    if (left && left !== id) void readPreview(left);
    // The command names belong to the agent's definition, so they do not survive the switch.
    commandsFor = undefined;
    publish({
      agentId: id,
      model: undefined,
      error: undefined,
      errorInConfig: undefined,
      loading: true,
      commands: [],
      commandsError: undefined,
    });
    try {
      const result = await api.openAgent(id);
      if (request !== navigation) return;
      if (!result.ok) {
        const state: AgentState = result.code === "failed" ? "broken" : result.code;
        publish({ loading: false, states: { ...view.states, [id]: state }, error: result.message, errorInConfig: result.inConfig });
        return;
      }
      publish({
        loading: false,
        model: result.model,
        // A re-read that started after this one already wrote a newer list.
        ...(listCurrent() ? { sessions: { ...view.sessions, [id]: result.sessions } } : {}),
        states: { ...view.states, [id]: "ready" },
      });
      const newest = [...result.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const running = [...conversations.values()].find((c) => c.agentId === id && busy(c));
      // Coming back to an agent returns to the conversation you left, including one the runtime does
      // not know yet. It is dropped when its session is gone and nothing local keeps it alive.
      const previous = lastOpened.get(id);
      const revivable =
        previous &&
        (result.sessions.some((s) => s.session === previous) ||
          conversations.has(key(id, previous)) ||
          drafts.get(key(id, previous))?.trim() ||
          previous === freshSession)
          ? previous
          : undefined;
      // `session` names the conversation the click was about. It is opened here, inside the same
      // navigation guard, rather than chained after this call — a `.then(open)` outside would land
      // on whichever agent the selection had moved to by the time the runtime finished starting.
      await open(session ?? revivable ?? running?.session ?? newest?.session ?? crypto.randomUUID());
    } catch (error) {
      if (request === navigation)
        publish({ loading: false, error: message(error), states: { ...view.states, [id]: "broken" } });
    }
  }

  /**
   * The model and thinking levels the runtime lists for a conversation, read again after a model change
   * replaced the runtime (its `state_changed` came before the subscription moved). A conversation with no
   * record yet has them too: the runtime reports what its first turn would run on.
   */
  async function readSettings(c: Conversation) {
    try {
      const { model, thinkingLevel, availableThinkingLevels } = await api.readState(c.agentId, c.session);
      // The read outlived the conversation (closed, or replaced by a reopen): it says nothing about this one.
      if (conversations.get(key(c.agentId, c.session)) !== c || !c.state) return;
      // The runtime leaves all three out when it cannot resolve them (no session boundary, or an entry chain
      // it cannot read); what the events already said about the model is not erased by that silence.
      c.state = {
        ...c.state,
        ...(model !== undefined && { model }),
        ...(thinkingLevel !== undefined && { thinkingLevel }),
        ...(availableThinkingLevels !== undefined && { availableThinkingLevels }),
      };
      publish();
    } catch (error) {
      note(c, { error, title: "This conversation's settings could not be read" });
    }
  }
  /**
   * Setting a model or effort on a conversation not begun yet makes the runtime keep a record of it. The list
   * is read again then, so the conversation stays reachable once the person leaves it, rather than vanishing
   * until some later read brings it back.
   */
  async function keepListed(c: Conversation) {
    if (!view.sessions[c.agentId]?.some((s) => s.session === c.session)) await listSessions(c.agentId);
  }
  function fold(c: Conversation, event: SessionEvent) {
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
      // A run that ends while you are reading something else is the thing you came back for. A run
      // you stopped yourself is not news.
      if (c !== view.conversation && e.data.status !== "aborted")
        unseen.set(key(c.agentId, c.session), e.data.status === "completed" ? "done" : "failed");
      void listSessions(c.agentId);
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
    if (event.type === "run_settled") ranNothing(c);
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
    if (!known) c.items = [...c.items, { kind: "user", text: own?.text ?? text, at, steered: c.runHasUser, entryId }];
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
  function ranNothing(c: Conversation) {
    const ran = c.waiting.filter((item) => c.returned.has(item));
    if (!ran.length) return;
    c.waiting = c.waiting.filter((item) => !c.returned.has(item));
    c.returned.clear();
    const at = Date.now();
    c.items = [...c.items, ...ran.map((item): Item => ({ kind: "note", tone: "info", text: `ran ${item.text}`, at }))];
  }
  const onFrame = (frame: SessionFrame) => {
    const c = conversations.get(key(frame.agentId, frame.session));
    if (!c || c.subscription !== frame.subscription) return;
    if (frame.ended) {
      // Nothing will report the end of a run this view can no longer hear, so stop waiting for one.
      // Retry re-opens and re-reads the runtime's real state.
      if (c.state) c.state = { ...c.state, status: "idle", activeRunId: undefined };
      // A tool's clock is a claim that it is still being watched. It stops where this view stopped
      // hearing; how long the tool really ran is no longer knowable here.
      const now = Date.now();
      c.items = c.items.map((item) =>
        item.kind === "tool" && item.status === "running" && item.ended === undefined ? { ...item, ended: now } : item,
      );
      if (frame.ended.why !== "failed") c.ended = frame.ended.reason;
      else
        c.error = {
          title: "The live connection to this conversation was lost",
          advice: "A run in it goes on in duang. Reconnect to see where it is now.",
          reason: frame.ended.reason,
        };
      publish();
      // FastAgent's contract for a subscriber it let go (a backlog that overflowed, a runtime replaced): listen
      // again and read the history. The open conversation does that once by itself; one that ends again soon
      // after says so and waits for the person, rather than reconnecting in a loop. Not while a send is still
      // answering: a refused one puts its words back in this conversation's composer, which reopening replaces.
      const id = key(c.agentId, c.session);
      if (
        frame.ended.why === "let_go" &&
        view.conversation === c &&
        c.sends === 0 &&
        Date.now() - (reconnected.get(id) ?? -Infinity) > RECONNECT_GAP_MS
      ) {
        reconnected.set(id, Date.now());
        close(c);
        void open(c.session);
      }
      return;
    }
    if (!PERSON_SIDE.has(frame.event.type)) c.heard = Date.now();
    if (c.loading) c.events.push(frame.event);
    else fold(c, frame.event);
    publish();
  };
  /**
   * What main pushes to this window, registered by `load` and dropped by `dispose`: App's effect
   * setup and cleanup. React runs that cleanup and then the setup again on the same store (Fast
   * Refresh does, on every edit in development), so registering anywhere else left a store that
   * still read history and lists but never heard a live event, and every run looked stuck.
   */
  let stopFrames: (() => void) | undefined;
  /** When each conversation last reconnected by itself, so a subscription that keeps ending is said, not looped. */
  const reconnected = new Map<string, number>();
  let resetting = false;
  let stopSteps: (() => void) | undefined;
  const listen = () => {
    stopFrames ??= api.onSessionEvent(onFrame);
    stopSteps ??= api.onLoginStep(onStep);
  };

  /** `fresh`: start on a new conversation of the agent, not the one it was left on (main asks after crashes). */
  async function load({ fresh = false }: { fresh?: boolean } = {}) {
    listen();
    publish({ loading: true, error: undefined, registryError: undefined });
    // The avatars' style is read beside the agent list and lands first, so the roster is never drawn in
    // the default style and then redrawn. Its one failure is an unreadable settings file, which leaves the
    // default: main reports it when it starts, and the Settings page when it is opened.
    const avatar = api.getSettings().then(
      ({ avatar }) => publish({ avatar }),
      () => {},
    );
    try {
      const agents = await api.listAgents();
      await avatar;
      publish({ agents, loading: false });
      // Reopen the agent this machine was last using; a removed one falls back to the first row.
      const start = agents.find((row) => row.id === lastAgent) ?? agents[0];
      // Every row shows its latest conversation, so every agent's list is read; that boots each
      // runtime, the same as opening it would.
      for (const row of agents) if (row !== start) void listSessions(row.id);
      if (fresh) freshSession = crypto.randomUUID();
      if (start) await selectAgent(start.id, fresh ? freshSession : undefined);
    } catch (error) {
      publish({ loading: false, registryError: message(error) });
    }
  }

  return {
    ...settings,
    getSnapshot: () => view,
    /** Where this conversation was left, if it was left above the latest line. */
    scrollOf: (agentId: string, session: string) => scrolls.get(key(agentId, session)),
    /** `undefined`: at the latest line, which is where a conversation opens anyway. */
    rememberScroll(agentId: string, session: string, top: number | undefined) {
      if (top === undefined) scrolls.delete(key(agentId, session));
      else scrolls.set(key(agentId, session), top);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    selectAgent,
    /**
     * Conversations for an agent that is not open. This boots that agent's runtime, the same as
     * opening it would: FastAgent owns the session list, and duang will not keep a second copy of
     * where sessions live.
     *
     * A failure belongs to that agent, never to the transcript being read, so it is published
     * against that agent and its row says it. It deliberately does not touch `states`: that drives
     * the main panel, and a background read of the open agent would otherwise put the window into
     * "this agent is broken" with no message to show for it.
     */
    listSessions,
    /** duang's label for the agent; the directory keeps its name. */
    async renameAgent(id: string, name: string) {
      try {
        await api.renameAgent(id, name);
        publish({ agents: await api.listAgents() });
      } catch (error) {
        fail("The agent was not renamed", error);
      }
    },
    open,
    /**
     * Read on every opening of the picker, for the open agent: its own `models.json` is part of the
     * list, and a provider connected or disconnected in Settings shows on the next opening.
     */
    async loadModels() {
      const id = view.agentId;
      const request = ++modelsRequest;
      publish({ models: undefined, modelsError: undefined, modelsRefresh: undefined });
      if (!id) return;
      try {
        const models = await api.listModels(id);
        if (request === modelsRequest) publish({ models });
      } catch (error) {
        if (request === modelsRequest) publish({ modelsError: message(error) });
      }
    },
    /**
     * Fetches models released after the bundled catalog, for the open agent, when the person asks.
     * The list stays as it was on a failure, with the reason beside it: a failed refresh does not
     * make the models already there any less runnable. A reopened picker reads the list itself and
     * drops this one's answer, as does a switch to another agent.
     */
    async refreshModels() {
      const id = view.agentId;
      // Not before the list has arrived: there would be nothing to count against, and the reading in flight
      // would be dropped (a failure then leaves a picker with no list and nothing to retry).
      if (!id || !view.models || view.modelsRefresh?.status === "running") return;
      const request = ++modelsRequest;
      const before = new Set(view.models.map((model) => model.spec));
      publish({ modelsRefresh: { status: "running" } });
      try {
        const models = await api.refreshModels(id);
        if (request !== modelsRequest || view.agentId !== id) return;
        publish({ models, modelsRefresh: { status: "done", added: models.filter((model) => !before.has(model.spec)).length } });
      } catch (error) {
        if (request === modelsRequest && view.agentId === id)
          publish({ modelsRefresh: { status: "failed", error: message(error) } });
      }
    },
    /**
     * Asked whenever the open conversation's provider or run state changes; main answers from its
     * cache inside the gap, so asking often costs nothing. A failure replaces the numbers: showing a
     * stale percentage as current would be the quiet kind of wrong.
     */
    async loadUsage(provider: string) {
      try {
        const data = await api.providerUsage(provider);
        publish({ usage: { ...view.usage, [provider]: { data } } });
      } catch (error) {
        publish({ usage: { ...view.usage, [provider]: { error: message(error) } } });
      }
    },
    dismissFailure: () => publish({ failure: undefined }),
    /** A plan whose usage only its provider's page shows: main opens that page in the browser. */
    async openUsagePage(provider: string) {
      try {
        await api.openUsagePage(provider);
      } catch (error) {
        fail("The usage page did not open", error);
      }
    },
    /** Once per agent, on the first `/`: the names are the definition's, and it is live. */
    async loadCommands() {
      const id = view.agentId;
      if (!id || commandsFor === id) return;
      commandsFor = id;
      try {
        const commands = await api.listCommands(id);
        if (commandsFor === id) publish({ commands });
      } catch (error) {
        // Release the once-per-agent claim: without this the agent is stuck with an empty
        // completion list for the rest of the session. The next `/` keystroke retries.
        if (commandsFor === id) {
          commandsFor = undefined;
          publish({ commandsError: message(error) });
        }
      }
    },
    newConversation: () => open(crypto.randomUUID()),
    setDraft: (draft: string) => {
      if (view.conversation) {
        view.conversation.draft = draft;
        publish();
      }
    },
    async addAgent() {
      try {
        const row = await api.addAgent();
        if (!row) return;
        publish({ agents: await api.listAgents() });
        await selectAgent(row.id);
      } catch (error) {
        fail("The agent was not added", error);
      }
    },
    async pickModel(model: string) {
      const id = view.agentId;
      const c = view.conversation;
      if (!id) return;
      const request = navigation;
      // Cleared however the change ends, including after the person went to another agent.
      const settle = () => {
        if (view.changingModel === id) publish({ changingModel: undefined });
      };
      publish({ changingModel: id });
      try {
        const result = await api.setModel(id, model, c?.session);
        if (!result.ok) {
          settle();
          // The model did not change, so nothing ran: this is a refusal, not a failure.
          return note(c, { error: result.error.message, tone: "warning", title: "The model was not changed" });
        }
        publish({ agents: await api.listAgents() });
        settle();
        if (request !== navigation) return;
        publish({ model, error: undefined, unavailable: undefined, states: { ...view.states, [id]: "ready" } });
        // The open conversation stays exactly as it is: main moved its subscription to the new runtime.
        // The runtime announced the change before that subscription listened again, so the model and
        // levels are read, not waited for.
        if (c) {
          await readSettings(c);
          await keepListed(c);
          // Chosen on the new-conversation page of an agent with no model yet: that page, whose composer now runs
          // on it, not the agent's latest conversation, which keeps the model it was recorded with.
        } else await selectAgent(id, crypto.randomUUID());
      } catch (error) {
        settle();
        if (request === navigation) note(c, { error, title: "The model was not changed" });
      }
    },
    /**
     * The open conversation's thinking level. Nothing is shown ahead of the runtime: the new level
     * arrives as its own `state_changed`, and a refusal is shown as one.
     */
    async setThinking(level: string) {
      const id = view.agentId;
      const c = view.conversation;
      if (!id || !c) return;
      try {
        const result = await api.setThinking(id, c.session, level);
        if (!result.ok) note(c, { error: result.error.message, tone: "warning", title: "The effort was not changed" });
        else await keepListed(c);
      } catch (error) {
        note(c, { error, title: "The effort was not changed" });
      }
    },
    /** The agent's config does not load: a fresh one in its place, the old one kept beside it. */
    async resetConfig() {
      const id = view.agentId;
      // One at a time: the page stays up until the agent has reopened, and a second click is not a second reset.
      if (!id || resetting) return;
      resetting = true;
      try {
        const result = await api.resetAgentConfig(id);
        if (!result.ok) return fail("The config was not replaced", result.error.message);
        await selectAgent(id);
      } catch (error) {
        fail("The config was not replaced", error);
      } finally {
        resetting = false;
      }
    },
    /** The agent's folder was moved: the person shows where it is, and the agent opens from there. */
    async relocateAgent() {
      const id = view.agentId;
      if (!id) return;
      try {
        const result = await api.relocateAgent(id);
        if (!result) return;
        if (!result.ok) return fail("The agent was not moved", result.error.message);
        publish({ agents: await api.listAgents() });
        await selectAgent(id);
      } catch (error) {
        fail("The agent was not moved", error);
      }
    },
    async scaffold() {
      const id = view.agentId;
      if (!id) return;
      const request = navigation;
      try {
        await api.scaffoldAgent(id);
        if (request === navigation) await selectAgent(id);
      } catch (error) {
        if (request === navigation) fail("The agent could not be created here", error);
      }
    },
    async reveal(agentId = view.agentId) {
      try {
        // No agent to name means the list itself is what failed; show that file instead.
        await (agentId ? api.revealAgent(agentId) : api.revealRegistry());
      } catch (error) {
        fail("It could not be shown in Finder", error);
      }
    },
    async removeAgent() {
      const id = view.agentId;
      if (!id) return;
      try {
        const result = await api.removeAgent(id);
        if (!result.ok) return fail("The agent was not removed", result.error.message);
        for (const c of conversations.values()) if (c.agentId === id) close(c);
        for (const draftKey of [...drafts.keys()]) if (draftKey.startsWith(`${id}/`)) drafts.delete(draftKey);
        for (const scrollKey of [...scrolls.keys()]) if (scrollKey.startsWith(`${id}/`)) scrolls.delete(scrollKey);
        publish({ agents: await api.listAgents() });
        if (view.agentId !== id) return;
        ++navigation;
        const { [id]: _gone, ...rest } = view.sessions;
        publish({ agentId: undefined, conversation: undefined, error: undefined, sessions: rest });
        if (view.agents[0]) await selectAgent(view.agents[0].id);
      } catch (error) {
        fail("The agent was not removed", error);
      }
    },
    /**
     * Names a conversation, in FastAgent, which owns the label. The list is re-read afterwards
     * rather than patched locally: the summary that matters is the one the runtime reports.
     */
    async renameSession(id: string, session: string, name: string) {
      try {
        const result = await api.renameSession(id, session, name);
        if (!result.ok) return reportOn(id, session, "The conversation was not renamed", result.error.message, "warning");
        // The name is FastAgent's now; re-read rather than patch, through the same ordered path
        // expanding uses, so a failed read is reported instead of leaving the old label in place.
        await listSessions(id);
      } catch (error) {
        reportOn(id, session, "The conversation was not renamed", error, "warning");
      }
    },
    /** The sidebar can delete a conversation of an agent that is not the open one, so it is named. */
    async deleteSession(id: string, session: string) {
      try {
        const result = await api.deleteSession(id, session);
        // Refused: nothing was deleted, and the conversation it is about says so.
        if (!result.ok) return reportOn(id, session, "The conversation was not deleted", result.error.message, "warning");
        const c = conversations.get(key(id, session));
        if (c) close(c);
        drafts.delete(key(id, session));
        scrolls.delete(key(id, session));
        // The runtime confirmed the deletion, so the row goes now, whichever agent it belongs to.
        publish({
          sessions: { ...view.sessions, [id]: (view.sessions[id] ?? []).filter((s) => s.session !== session) },
        });
        if (id !== view.agentId) return void (await readPreview(id));
        if (view.conversation?.session === session) await open(crypto.randomUUID());
        await listSessions(id);
      } catch (error) {
        reportOn(id, session, "The conversation was not deleted", error, "error");
      }
    },
    async send() {
      const c = view.conversation;
      const text = c?.draft.trim();
      if (!c || !text) return;
      // The composer was disabled and said why, so arriving here is this app's bug rather than a
      // choice the person can revisit. Dropping the message in silence is how that stays hidden.
      if (view.blocked) throw new Error(`Cannot send while ${view.blocked}`);
      c.draft = "";
      await submit(c, text);
    },
    /**
     * Sends the failed turn's message again, as a new turn: the failure stays in the transcript, and so does
     * whatever the failed run already did. Offered only while `view.resend` is.
     */
    async resend() {
      const c = view.conversation;
      const again = view.resend;
      if (!c || !again) return;
      await submit(c, again.text);
    },
    async abort() {
      const c = view.conversation;
      if (!c) return;
      try {
        const result = await api.abort(c.agentId, c.session);
        // Nothing left running: the run ended as Stop was pressed, and its own ending is already in the
        // transcript. Main answers a Stop for a send that has not started a run yet with `ok`.
        if (!result.ok && result.error.code !== NO_ACTIVE_RUN_CODE)
          note(c, { error: result.error.message, title: "The run could not be stopped" });
      } catch (error) {
        note(c, { error, title: "The run could not be stopped" });
      }
    },
    async retry() {
      const c = view.conversation;
      if (c) {
        close(c);
        await open(c.session);
      } else if (view.agentId) await selectAgent(view.agentId);
      else await load();
    },
    dispose() {
      stopFrames?.();
      stopSteps?.();
      stopFrames = stopSteps = undefined;
      for (const c of conversations.values()) close(c);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
