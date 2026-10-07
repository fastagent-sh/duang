import { NO_ACTIVE_RUN_CODE, type AgentCommand, type SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, Models, ProviderUsage, SessionFrame } from "../preload/index.ts";
import { fromEntries, phase, previewOf, queueView, type Activity, type Place } from "./transcript.ts";
import {
  accepted,
  backfill,
  busy,
  createConversation,
  lost,
  receive,
  sent,
  unsent,
  type Conversation,
  type Settled,
  type Trouble,
} from "./conversation.ts";
import { message } from "./message.ts";
import type { Fix } from "./problems.ts";
import { createSettings, type SettingsView } from "./settings-store.ts";

const MODEL_UNAVAILABLE_CODE = "model_unavailable";
// A subscription lost again this soon after reconnecting by itself waits for the person.
const RECONNECT_GAP_MS = 30_000;

export type AgentState = "ready" | "no_agent" | "missing_dir" | "broken";
// `settling`: an agent still opening, or history not yet arrived; showing `start` there would flash the wrong screen.
type Pane =
  | "unreadable-registry"
  | "no-agents"
  | "broken"
  | "no-agent"
  | "missing-dir"
  | "settling"
  | "start"
  | "transcript";
// Navigation only: losing it costs one click, so it is best effort and anything unreadable is a first start.
const SELECTION_KEY = "duang.selection";
const DRAFTS_KEY = "duang.drafts";
// An unreadable drafts value is moved here so the next write does not replace the person's text.
const UNREADABLE_DRAFTS_KEY = "duang.drafts.unreadable";
interface Selection {
  agentId?: string;
  perAgent: [string, string][];
  // A crash-recovery conversation, kept as the selection so a reload does not reopen the one that crashed.
  fresh?: string;
}
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
  } catch (error) {
    // A full or disabled store costs a click, or unsent text, after the next restart; the window goes on, and
    // the log says why.
    console.error(`duang: ${storageKey} was not saved:`, error);
  }
}
// Presentation only: never written anywhere; the transcript stays the runtime's.
export interface Preview {
  session: string;
  text?: string;
  at?: number;
  error?: string;
}
export interface View extends SettingsView {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  sessions: Record<string, SessionSummary[]>;
  // An empty list and a failed one are not the same.
  sessionsError: Record<string, string>;
  model?: string;
  loading: boolean;
  changingModel?: string;
  error?: string;
  errorInConfig?: true;
  staleDefault?: { agentId: string; model: string };
  failure?: { title: string; reason: string };
  registryError?: string;
  models?: Models;
  modelsError?: string;
  modelsRefresh?: { status: "running" } | { status: "done"; added: number } | { status: "failed"; error: string };
  commands: AgentCommand[];
  commandsError?: string;
  conversation?: Conversation;
  busy: boolean;
  pane: Pane;
  alert?: Trouble;
  // One rule: the placeholder shows it and `send` treats reaching it as a bug.
  blocked?: string;
  resend?: { text: string; toolsRan: boolean };
  unavailable?: { agentId: string; session: string; model: string };
  picker: boolean;
  needsModel: boolean;
  modelBlocked?: string;
  running: Record<string, string[]>;
  doing: Record<string, Activity>;
  unsent: Record<string, string[]>;
  // Spent by opening the conversation, like an unread mark.
  unseen: Record<string, Record<string, "done" | "failed">>;
  usage: Record<string, { data?: ProviderUsage; error?: string }>;
  previews: Record<string, Preview>;
}
const key = (agentId: string, session: string) => `${agentId}/${session}`;
const unkey = (id: string): [string, string] => [id.slice(0, id.indexOf("/")), id.slice(id.indexOf("/") + 1)];
const group = (pairs: [string, string][]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [agentId, session] of pairs) (out[agentId] ??= []).push(session);
  return out;
};

// The pane, the alert and why the composer cannot send are one decision, made only here.
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
  const sessions = view.sessions[agentId] ?? [];
  // A ready agent with no conversation open is about to open one: its newest, if it has any.
  if (c ? c.loading && sessions.some((s) => s.session === c.session) : sessions.length > 0) return "settling";
  const shown = c && (c.items.length > 0 || queueView(c.waiting, c.state?.pending.steering ?? []).length > 0);
  return shown ? "transcript" : "start";
}
function alertOf(view: View): Trouble | undefined {
  const c = view.conversation;
  if (c?.error) return c.error;
  if (!view.agentId || !view.error) return undefined;
  // A setup problem's own panel offers the fix; the runtime's prose ("run `fastagent init`") would contradict it.
  const state = view.states[view.agentId];
  if (state === "broken" || state === "no_agent" || state === "missing_dir") return undefined;
  return { title: "This agent could not be opened", advice: "Try again; its folder and conversations are untouched.", reason: view.error };
}
function modelBlockedBy(view: View): string | undefined {
  const { agentId, conversation: c } = view;
  if (!agentId) return "Select an agent first";
  // FastAgent refuses either change while a run holds the conversation (`session_busy`) rather than queueing it.
  if (view.busy) return "Stop the turn to change the model or effort";
  const state = view.states[agentId];
  if (view.loading || view.changingModel === agentId || c?.loading || state === "broken" || state === "no_agent" || state === "missing_dir")
    return "This agent is not ready";
  return undefined;
}
function blockedBy(view: View): string | undefined {
  const c = view.conversation;
  const state = view.agentId ? view.states[view.agentId] : undefined;
  if (view.loading || c?.loading) return "opening conversation…";
  if (view.agentId && view.changingModel === view.agentId) return "changing the model…";
  if (c?.error || c?.ended) return "reconnect before sending";
  if (state === "broken") return "this agent is broken";
  if (state === "no_agent") return "create an agent here first";
  if (state === "missing_dir") return "this agent's folder is missing";
  if (!c) return "no conversation";
  if (state !== "ready") return "this agent is not ready";
  // A conversation that records no model, of an agent with no default: it runs once one is chosen.
  if (!(c.state?.model ?? view.model)) return "pick a model to start";
  return undefined;
}

// Runtime data stays in the runtime; this store owns selection, drafts and live, not-yet-durable output.
function derive(
  view: View,
  held: Conversation[],
  unsent: Map<string, string>,
  unseen: Map<string, "done" | "failed">,
): View {
  const running = held.filter(busy);
  const open = view.conversation;
  const derived: View = {
    ...view,
    busy: !!open && busy(open),
    running: group(running.map((c) => [c.agentId, c.session])),
    doing: Object.fromEntries(running.map((c) => [c.agentId, phase(c.items, c.state?.status).activity])),
    unsent: group([...unsent].filter(([, text]) => text.trim()).map(([id]) => unkey(id))),
    unseen: {},
    // As opposed to duang not knowing the model yet, which does not ask for one.
    needsModel: !!open && !open.loading && view.states[open.agentId] === "ready" && !(open.state?.model ?? view.model),
  };
  for (const [id, outcome] of unseen) {
    const [agentId, session] = unkey(id);
    (derived.unseen[agentId] ??= {})[session] = outcome;
  }
  derived.pane = paneOf(derived);
  derived.alert = alertOf(derived);
  derived.blocked = blockedBy(derived);
  derived.modelBlocked = modelBlockedBy(derived);
  // Anything after the failure (a newer turn, a stop) leaves nothing to send again.
  const last = open?.items.at(-1);
  derived.resend = !derived.busy && !derived.blocked && last?.kind === "note" ? last.resend : undefined;
  return derived;
}

export function createStore(api: DuangApi) {
  let view: View = {
    agents: [],
    states: {},
    sessions: {},
    sessionsError: {},
    loading: false,
    busy: false,
    pane: "no-agents",
    picker: false,
    needsModel: false,
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
  // Where each conversation was left scrolled above the latest line: leaving it unmounts its view.
  const scrolls = new Map<string, Place>();
  let persisted = "";
  let needsAsked: string | undefined;
  const stored = readSelection();
  const lastOpened = new Map<string, string>(stored?.perAgent);
  // In memory on purpose: it is about this window's attention; the transcript is the only durable record.
  const unseen = new Map<string, "done" | "failed">();
  let lastAgent = stored?.agentId;
  let freshSession = stored?.fresh;
  let navigation = 0;
  // One request number per agent: a slow answer never overwrites a newer one.
  const tickets = () => {
    const latest = new Map<string, number>();
    return (id: string) => {
      const request = (latest.get(id) ?? 0) + 1;
      latest.set(id, request);
      return () => latest.get(id) === request;
    };
  };
  const listTicket = tickets();
  const previewTicket = tickets();
  let modelsRequest = 0;
  const previews = new Map<string, Preview & { updatedAt?: number }>();
  let commandsFor: string | undefined;
  // Same order `selectAgent` reopens in, so the row quotes what a click would show.
  const selectedSession = (id: string): string | undefined => {
    if (view.conversation?.agentId === id) return view.conversation.session;
    const list = view.sessions[id] ?? [];
    const left = lastOpened.get(id);
    if (left && (list.some((s) => s.session === left) || conversations.has(key(id, left)))) return left;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.session;
  };
  const publish = (patch: Partial<View> = {}) => {
    view = { ...view, ...patch };
    // Read before the loop below releases anything: a settled run's last event is what the row keeps.
    // A sent message is the newest thing from the moment it is sent, not once the runtime reports it.
    for (const c of conversations.values())
      if (!c.loading && selectedSession(c.agentId) === c.session) {
        const opening = c.waiting.findLast((item) => item.opens);
        previews.set(c.agentId, { session: c.session, ...previewOf(opening ? [...c.items, opening] : c.items) });
      }
    for (const [id, preview] of previews) if (selectedSession(id) !== preview.session) previews.delete(id);
    view.previews = Object.fromEntries([...previews].map(([id, { updatedAt: _read, ...preview }]) => [id, preview]));
    // Retention is decided here, where every way a turn ends passes. A conversation nobody looks at is kept
    // only while it can still produce something: its own backfill, or a turn in flight.
    for (const c of conversations.values()) if (!busy(c) && c !== view.conversation && !c.loading) close(c);
    // A conversation the runtime never heard of exists only on screen, so leaving its unsent text would discard it.
    const unsent = new Map(drafts);
    if (view.conversation) unsent.set(key(view.conversation.agentId, view.conversation.session), view.conversation.draft);
    const serialized = JSON.stringify([...unsent].filter(([, text]) => text.trim()));
    if (serialized !== persisted) {
      persisted = serialized;
      writeStored(DRAFTS_KEY, serialized);
    }
    view = derive(view, [...conversations.values()], unsent, unseen);
    // Only on these changes: a list the person closed stays closed.
    const asks = `${view.conversation?.agentId}/${view.conversation?.session}/${view.needsModel}`;
    if (asks !== needsAsked) {
      needsAsked = asks;
      view.picker = view.needsModel;
    }
    for (const listener of listeners) listener();
  };
  // `warning` is a refusal: it never ran, so the text is still the person's; a failure already had effects.
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
  const fail = (title: string, error: unknown) => publish({ failure: { title, reason: message(error) } });
  // Never on its agent's row, which means the list could not be read: a refused delete is not that.
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

  // A failure lands on that agent's row: an empty list and an unreadable one are not the same answer.
  async function listSessions(id: string) {
    const current = listTicket(id);
    const settle = (patch: Partial<View>) => {
      if (current()) publish(patch);
    };
    // Never the open agent's `states`: they drive the main panel, which `selectAgent` owns.
    const own = (value: AgentState, model?: string) =>
      id === view.agentId ? (model ? { model } : {}) : { states: { ...view.states, [id]: value } };
    try {
      const result = await api.openAgent(id);
      if (!result.ok)
        return settle({
          sessionsError: { ...view.sessionsError, [id]: result.message },
          ...own(result.code),
        });
      const { [id]: _cleared, ...errors } = view.sessionsError;
      settle({ sessions: { ...view.sessions, [id]: result.sessions }, sessionsError: errors, ...own("ready", result.model) });
      if (current()) await readPreview(id);
    } catch (error) {
      settle({ sessionsError: { ...view.sessionsError, [id]: message(error) } });
    }
  }

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
    unseen.delete(key(agentId, session));
    lastOpened.set(agentId, session);
    lastAgent = agentId;
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
    const c = createConversation(agentId, session, drafts.get(key(agentId, session)) ?? "");
    conversations.set(key(agentId, session), c);
    publish({ conversation: c, error: undefined, unavailable: undefined });
    try {
      const result = await api.openSession(agentId, session, c.subscription);
      if (conversations.get(key(agentId, session)) !== c) return;
      for (const outcome of backfill(c, result, Date.now())) settled(c, outcome);
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

  async function submit(c: Conversation, text: string) {
    // Notes from before this send are not this send's: a refusal said for an earlier message is said again.
    const before = c.items.length;
    const echo = sent(c, text, Date.now());
    // Once it entered, what happens to it is the run's.
    const waiting = () => c.waiting.includes(echo);
    c.sends++;
    publish();
    try {
      const result = await api.send(c.agentId, c.session, text);
      if (!result.ok) {
        // Once it entered, the failure is the run's, and the run's note already says it.
        if (!waiting()) return;
        const model = c.state?.model ?? view.model;
        if (result.error.code === MODEL_UNAVAILABLE_CODE && model) {
          // Nothing happened in the conversation, so nothing goes in the transcript; the picker says why.
          unsent(c, echo);
          publish({ unavailable: { agentId: c.agentId, session: c.session, model }, picker: true });
          return;
        }
        if (
          result.error.code !== "aborted" &&
          !c.items.slice(before).some((item) => item.kind === "note" && item.text.includes(result.error.message))
        )
          note(c, { error: result.error.message, tone: "warning", title: "Not sent", advice: "Your message is back in the composer." });
        unsent(c, echo);
      } else if (waiting()) accepted(c, echo, Date.now());
    } catch (error) {
      note(c, { error, title: "The message could not be sent" });
      if (waiting()) unsent(c, echo);
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
    if (left && left !== id) void readPreview(left);
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
        publish({ loading: false, states: { ...view.states, [id]: result.code }, error: result.message, errorInConfig: result.inConfig });
        return;
      }
      publish({
        loading: false,
        model: result.model,
        ...(listCurrent() ? { sessions: { ...view.sessions, [id]: result.sessions } } : {}),
        states: { ...view.states, [id]: "ready" },
      });
      const newest = [...result.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const running = [...conversations.values()].find((c) => c.agentId === id && busy(c));
      // Including a conversation the runtime does not know yet; dropped when nothing local keeps it alive.
      const previous = lastOpened.get(id);
      const revivable =
        previous &&
        (result.sessions.some((s) => s.session === previous) ||
          conversations.has(key(id, previous)) ||
          drafts.get(key(id, previous))?.trim() ||
          previous === freshSession)
          ? previous
          : undefined;
      // Opened here, inside the navigation guard: a `.then(open)` outside would land on whichever agent the
      // selection had moved to by then.
      await open(session ?? revivable ?? running?.session ?? newest?.session ?? crypto.randomUUID());
      // After the conversation opened: opening one sets the picker by whether it has a model.
      if (request === navigation)
        publish(result.staleDefault ? { staleDefault: { agentId: id, model: result.staleDefault }, picker: true } : { staleDefault: undefined });
    } catch (error) {
      if (request === navigation)
        publish({ loading: false, error: message(error), states: { ...view.states, [id]: "broken" } });
    }
  }

  // Read again after a model change: its `state_changed` came before the subscription moved.
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
  // Setting a model on a conversation not begun yet makes the runtime record it; re-list so it stays reachable.
  async function keepListed(c: Conversation) {
    if (!view.sessions[c.agentId]?.some((s) => s.session === c.session)) await listSessions(c.agentId);
  }
  // A run you stopped yourself is not news.
  function settled(c: Conversation, outcome: Settled) {
    if (c !== view.conversation && outcome !== "aborted")
      unseen.set(key(c.agentId, c.session), outcome === "completed" ? "done" : "failed");
    void listSessions(c.agentId);
  }
  const onFrame = (frame: SessionFrame) => {
    const c = conversations.get(key(frame.agentId, frame.session));
    if (!c || c.subscription !== frame.subscription) return;
    if (frame.ended) {
      lost(c, frame.ended, Date.now());
      publish();
      // FastAgent's contract for a subscriber it let go: listen again and read the history. Once by itself; again
      // soon after waits for the person. Not while a send answers: a refusal refills this composer, which reopening replaces.
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
    const outcome = receive(c, frame.event, Date.now());
    if (outcome) settled(c, outcome);
    publish();
  };
  // Registered by `load` and dropped by `dispose`: React (and Fast Refresh) re-runs setup on the same store,
  // and registering anywhere else left a store that never heard a live event.
  let stopFrames: (() => void) | undefined;
  const reconnected = new Map<string, number>();
  let resetting = false;
  let stopSteps: (() => void) | undefined;
  const listen = () => {
    stopFrames ??= api.onSessionEvent(onFrame);
    stopSteps ??= api.onLoginStep(onStep);
  };

  async function load({ fresh = false }: { fresh?: boolean } = {}) {
    listen();
    publish({ loading: true, error: undefined, registryError: undefined });
    // Lands before the roster, so it is never drawn in the default style first. An unreadable settings file
    // keeps the default; main and the Settings page report it.
    const avatar = api.getSettings().then(
      ({ avatar }) => publish({ avatar }),
      () => {},
    );
    try {
      const agents = await api.listAgents();
      await avatar;
      publish({ agents, loading: false });
      const start = agents.find((row) => row.id === lastAgent) ?? agents[0];
      // Reading each list boots each runtime, the same as opening it would.
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
    scrollOf: (agentId: string, session: string) => scrolls.get(key(agentId, session)),
    rememberScroll(agentId: string, session: string, place: Place | undefined) {
      if (place === undefined) scrolls.delete(key(agentId, session));
      else scrolls.set(key(agentId, session), place);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    selectAgent,
    // FastAgent owns the session list; duang keeps no second copy. A failure belongs to that agent's row and never
    // touches the open agent's `states`, which would put the window into "this agent is broken".
    listSessions,
    async renameAgent(id: string, name: string) {
      try {
        await api.renameAgent(id, name);
        publish({ agents: await api.listAgents() });
      } catch (error) {
        fail("The agent was not renamed", error);
      }
    },
    open,
    // Read on every opening: the agent's `models.json` and Settings' provider changes show up.
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
    // A failed refresh keeps the list: the models already there are no less runnable.
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
    // Main answers from its cache inside the gap. A failure replaces the numbers: a stale percentage is quietly wrong.
    async loadUsage(provider: string) {
      try {
        const data = await api.providerUsage(provider);
        publish({ usage: { ...view.usage, [provider]: { data } } });
      } catch (error) {
        publish({ usage: { ...view.usage, [provider]: { error: message(error) } } });
      }
    },
    dismissFailure: () => publish({ failure: undefined }),
    openPicker: () => publish({ picker: true }),
    closePicker: () => publish({ picker: false }),
    async openUsagePage(provider: string) {
      try {
        await api.openUsagePage(provider);
      } catch (error) {
        fail("The usage page did not open", error);
      }
    },
    async loadCommands() {
      const id = view.agentId;
      if (!id || commandsFor === id) return;
      commandsFor = id;
      try {
        const commands = await api.listCommands(id);
        if (commandsFor === id) publish({ commands });
      } catch (error) {
        // Without this the agent keeps an empty completion list; the next `/` retries.
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
      if (!id || !c) return;
      const request = navigation;
      // Cleared however the change ends, including after the person went to another agent.
      const settle = () => {
        if (view.changingModel === id) publish({ changingModel: undefined });
      };
      publish({ changingModel: id });
      try {
        const result = await api.setModel(id, model, c.session);
        if (!result.ok) {
          settle();
          // The model did not change, so nothing ran: this is a refusal, not a failure.
          return note(c, { error: result.error.message, tone: "warning", title: "The model was not changed" });
        }
        publish({ agents: await api.listAgents() });
        settle();
        if (request !== navigation) return;
        publish({ model, error: undefined, unavailable: undefined, staleDefault: undefined, states: { ...view.states, [id]: "ready" } });
        // The runtime announced the change before the subscription listened again, so read the settings, not wait.
        await readSettings(c);
        await keepListed(c);
      } catch (error) {
        settle();
        if (request === navigation) note(c, { error, title: "The model was not changed" });
      }
    },
    // Nothing shown ahead of the runtime: the new level arrives as its own `state_changed`.
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
    async renameSession(id: string, session: string, name: string) {
      try {
        const result = await api.renameSession(id, session, name);
        if (!result.ok) return reportOn(id, session, "The conversation was not renamed", result.error.message, "warning");
        // Re-read rather than patch, so a failed read is reported instead of keeping the old label.
        await listSessions(id);
      } catch (error) {
        reportOn(id, session, "The conversation was not renamed", error, "warning");
      }
    },
    async deleteSession(id: string, session: string) {
      try {
        const result = await api.deleteSession(id, session);
        if (!result.ok) return reportOn(id, session, "The conversation was not deleted", result.error.message, "warning");
        const c = conversations.get(key(id, session));
        if (c) close(c);
        drafts.delete(key(id, session));
        scrolls.delete(key(id, session));
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
