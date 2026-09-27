import type { AgentCommand, SessionEvent, SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, Models, ProviderUsage, SessionFrame } from "../preload/index.ts";
import { apply, fromEntries, previewOf, type Item } from "./transcript.ts";

export type AgentState = "ready" | "missing_model" | "no_agent" | "broken";

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
  error?: string;
  /** Main ended this subscription on purpose. Nothing broke; this view just stopped listening. */
  ended?: string;
  sends: number;
  runStarts: number;
  events: SessionEvent[];
  /**
   * The runtime's steering queue (`pending.steering`), oldest first, as bubbles. A steer waits for the
   * run's next turn boundary, so showing it in `items` at send time puts it above output the model
   * produced without it. It moves into `items` when it leaves the runtime's list, which FastAgent
   * defines as entering the conversation.
   */
  queued: UserItem[];
  /** Sent as steers from this window, not listed by the runtime yet. */
  unlisted: UserItem[];
  /**
   * A message that starts a turn has been sent and its run has not started yet. A message sent now
   * joins that run. It is cleared at `run_started`: once the run is going, `status` says it, and
   * after it settles a new message starts a turn even while the first send is still returning.
   */
  starting: boolean;
}
type UserItem = Extract<Item, { kind: "user" }>;
const steer = (text: string, at: number): UserItem => ({ kind: "user", text, at, steered: true });
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
export interface View {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  /** Conversations per agent: every roster row shows its agent's latest one. */
  sessions: Record<string, SessionSummary[]>;
  /** Why an agent has no list, per agent. An empty list and a failed one are not the same. */
  sessionsError: Record<string, string>;
  model?: string;
  loading: boolean;
  error?: string;
  /** The model picker's contents: undefined while loading, so the picker can say so. */
  models?: Models;
  modelsError?: string;
  /** The `/` completion list for the selected agent. */
  commands: AgentCommand[];
  commandsError?: string;
  conversation?: Conversation;
  /** The open conversation has a turn in flight. Subscription retention and the run controls read this. */
  busy: boolean;
  /**
   * Why the composer cannot send, in the words the person should read, or undefined when it can.
   * One rule, derived once: the placeholder shows it and `send` treats reaching it as a bug.
   */
  blocked?: string;
  /** Conversations with a turn in flight, per agent: the sidebar asks this of every agent it lists. */
  running: Record<string, string[]>;
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
 * The sentence the other program wrote, and nothing of ours around it. Only unexpected failures
 * throw across IPC, and Electron wraps those as "Error invoking remote method 'x': Error: <what main
 * said>"; expected refusals arrive as values and never come through here.
 */
export const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    "",
  );

/** In the order the person should hear it: the nearest reason first, the agent's setup after. */
function blockedBy(view: View): string | undefined {
  const c = view.conversation;
  const state = view.agentId ? view.states[view.agentId] : undefined;
  if (view.loading || c?.loading) return "opening conversation…";
  if (c?.error || c?.ended) return "reconnect before sending";
  if (state === "broken") return "this agent is broken";
  if (state === "no_agent") return "create an agent here first";
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
    commands: [],
    running: {},
    unsent: {},
    unseen: {},
    usage: {},
    previews: {},
  };
  const listeners = new Set<() => void>();
  const conversations = new Map<string, Conversation>();
  const drafts = new Map<string, string>(readDrafts());
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
  let navigation = 0;
  let listRequest = 0;
  /** One request number per agent: a slow expand must not overwrite a newer answer for that agent. */
  const listRequests = new Map<string, number>();
  let modelsRequest = 0;
  /**
   * Previews by agent, with the list's `updatedAt` a read was taken at: a history read again only
   * when the conversation moved on or the row now speaks for another one.
   */
  const previews = new Map<string, Preview & { updatedAt?: number }>();
  const previewRequests = new Map<string, number>();
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
    view.blocked = blockedBy(view);
    for (const listener of listeners) listener();
  };
  /**
   * A fact about the session, in the transcript it belongs to. `refused` is its own tone because a
   * refused request never ran (§9): the text is still the person's to edit, while a failure has
   * already had effects.
   */
  const note = (error: unknown, c = view.conversation, tone: "warning" | "error" = "error") => {
    const text = message(error);
    if (c) {
      // main's sentence goes in verbatim; the tone is what says this was refused rather than failed,
      // and the transcript draws the word (§9).
      c.items = [...c.items, { kind: "note", tone, text, at: Date.now() }];
      publish();
    } else publish({ error: text });
  };
  const refusal = (reason: string, c = view.conversation) => note(reason, c, "warning");
  const close = (c: Conversation) => {
    drafts.set(key(c.agentId, c.session), c.draft);
    if (conversations.get(key(c.agentId, c.session)) === c) conversations.delete(key(c.agentId, c.session));
    void api.closeSession(c.subscription).catch((error) => note(error));
  };
  const leave = () => publish({ conversation: undefined });

  /**
   * Re-reads one agent's conversations. Ordered per agent, so a slow answer cannot overwrite a
   * newer one, and a failure lands on that agent's row instead of nowhere: an empty list and a list
   * that could not be read are not the same answer.
   */
  async function listSessions(id: string) {
    const request = (listRequests.get(id) ?? 0) + 1;
    listRequests.set(id, request);
    const settle = (patch: Partial<View>) => {
      if (listRequests.get(id) === request) publish(patch);
    };
    // Another agent's row says its setup in words, so the answer's state is kept for it. Never the
    // open agent's: `states` drives the main panel, and `selectAgent` owns that one.
    const state = (value: AgentState) => (id === view.agentId ? {} : { states: { ...view.states, [id]: value } });
    try {
      const result = await api.openAgent(id);
      if (!result.ok)
        return settle({
          sessionsError: { ...view.sessionsError, [id]: result.message },
          ...state(result.code === "failed" ? "broken" : result.code),
        });
      const { [id]: _cleared, ...errors } = view.sessionsError;
      settle({ sessions: { ...view.sessions, [id]: result.sessions }, sessionsError: errors, ...state("ready") });
      if (listRequests.get(id) === request) await readPreview(id);
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
    const request = (previewRequests.get(id) ?? 0) + 1;
    previewRequests.set(id, request);
    let preview: Preview;
    try {
      const history = await api.readSession(id, session);
      preview = { session, ...previewOf(fromEntries(history.entries, history.leafEntryId)) };
    } catch (error) {
      preview = { session, error: message(error) };
    }
    // Only the newest read lands. A conversation opened meanwhile, or a row that moved on to another,
    // needs nothing here: `publish` quotes the live one first and drops a quote that is not selected.
    if (previewRequests.get(id) !== request) return;
    previews.set(id, { ...preview, updatedAt });
    publish();
  }

  async function refreshList(id: string) {
    // Another agent's row still shows its latest activity, so its list is re-read too.
    if (id !== view.agentId) return listSessions(id);
    const request = ++listRequest;
    try {
      const result = await api.openAgent(id);
      if (id !== view.agentId || request !== listRequest) return;
      if (!result.ok) throw new Error(result.message);
      publish({ sessions: { ...view.sessions, [id]: result.sessions }, model: result.model });
    } catch (error) {
      if (id === view.agentId && request === listRequest) note(error);
    }
  }

  async function open(session: string) {
    const agentId = view.agentId;
    if (!agentId) return;
    // Looking at it is what spends the mark.
    unseen.delete(key(agentId, session));
    lastOpened.set(agentId, session);
    lastAgent = agentId;
    writeStored(SELECTION_KEY, JSON.stringify({ agentId, perAgent: [...lastOpened] } satisfies Selection));
    leave();
    const existing = conversations.get(key(agentId, session));
    if (existing) {
      publish({ conversation: existing, error: undefined });
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
      runStarts: 0,
      events: [],
      queued: [],
      unlisted: [],
      starting: false,
    };
    conversations.set(key(agentId, session), c);
    publish({ conversation: c, error: undefined });
    try {
      const result = await api.openSession(agentId, session, c.subscription);
      if (conversations.get(key(agentId, session)) !== c) return;
      c.items = fromEntries(result.entries.entries, result.entries.leafEntryId);
      c.state = result.state;
      c.queued = result.state.pending.steering.map((text) => steer(text, Date.now()));
      c.loading = false;
      // New sends are disabled until backfill finishes. An already-running local turn retains its
      // subscription and view across navigation, so its deltas are never reconstructed from history.
      for (const event of c.events) fold(c, event);
      c.events = [];
      publish();
    } catch (error) {
      if (conversations.get(key(agentId, session)) !== c) return;
      c.loading = false;
      c.error = message(error);
      publish();
    }
  }

  async function selectAgent(id: string, session?: string) {
    const request = ++navigation;
    ++listRequest;
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
      loading: true,
      commands: [],
      commandsError: undefined,
    });
    try {
      const result = await api.openAgent(id);
      if (request !== navigation) return;
      if (!result.ok) {
        const state: AgentState = result.code === "failed" ? "broken" : result.code;
        publish({ loading: false, states: { ...view.states, [id]: state }, error: result.message });
        return;
      }
      publish({
        loading: false,
        model: result.model,
        sessions: { ...view.sessions, [id]: result.sessions },
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
          drafts.get(key(id, previous))?.trim())
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

  function fold(c: Conversation, event: SessionEvent) {
    const state = c.state ?? { status: "idle", pending: { steering: [], followUp: [] } };
    const data = event.data as Record<string, unknown>;
    if (event.type === "run_started") {
      c.runStarts++;
      // No message of ours was waiting for a run, so this one belongs to the oldest unlisted
      // message: main found the runtime idle (the turn it meant to join never started) and started
      // a turn with it. It opens this run, so it goes above the run's output.
      const [opening] = c.unlisted;
      if (!c.starting && opening) {
        opening.steered = false;
        opening.at = event.timestamp;
        c.unlisted = c.unlisted.slice(1);
        c.items = [...c.items, opening];
      }
      c.starting = false;
      c.state = { ...state, status: "running", activeRunId: event.runId };
    } else if (event.type === "run_settled") {
      c.state = { ...state, status: "idle", activeRunId: undefined, pending: { steering: [], followUp: [] } };
      // A run that ends while you are reading something else is the thing you came back for. A run
      // you stopped yourself is not news.
      if (c !== view.conversation && data.status !== "aborted")
        unseen.set(key(c.agentId, c.session), data.status === "completed" ? "done" : "failed");
      void refreshList(c.agentId);
    } else if (event.type === "queue_changed") {
      const pending = data as unknown as SessionState["pending"];
      requeue(c, pending.steering, event.timestamp);
      c.state = { ...state, pending };
    } else if (event.type === "state_changed") {
      c.state = { ...state, ...data };
    }
    c.items = apply(c.items, event);
    if (event.type === "run_settled") settleQueue(c);
  }
  /**
   * Follow the runtime's steering list. The queue only loses entries at its head (they entered the
   * conversation, so they move into `items` now) and gains them at its tail. A new entry is this
   * window's own message when one was sent with that text; a slash command is listed expanded, so an
   * unmatched entry takes the oldest command sent. Anything else was queued elsewhere, or before a
   * reload, and still shows.
   */
  function requeue(c: Conversation, next: string[], at: number) {
    let read = 0;
    while (!c.queued.slice(read).every((item, i) => next[i] === item.text)) read++;
    const entered = c.queued.slice(0, read);
    for (const item of entered) item.at = at;
    c.items = [...c.items, ...entered];
    const kept = c.queued.slice(read);
    const added = next.slice(kept.length).map((text) => {
      const own = c.unlisted.find((item) => item.text === text) ?? c.unlisted.find((item) => item.text.startsWith("/"));
      if (!own) return steer(text, at);
      c.unlisted = c.unlisted.filter((item) => item !== own);
      return own;
    });
    c.queued = [...kept, ...added];
  }
  /**
   * The run is gone. What its queue still listed never entered the conversation and was dropped:
   * it returns to the draft rather than stay on screen as if delivered. Messages the runtime never
   * listed did not reach this run; main is starting a new turn with them, so they are ordinary
   * messages now, after the run's closing note.
   */
  function settleQueue(c: Conversation) {
    const dropped = c.queued;
    const unsent = c.unlisted;
    c.queued = [];
    c.unlisted = [];
    if (dropped.length) c.draft = [...dropped.map((item) => item.text), c.draft].filter(Boolean).join("\n");
    // Changed in place: a send that fails later finds and removes its message by identity.
    for (const item of unsent) item.steered = false;
    c.items = [...c.items, ...unsent];
  }
  const unsubscribe = api.onSessionEvent((frame: SessionFrame) => {
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
      if (frame.ended.expected) c.ended = frame.ended.reason;
      else c.error = frame.ended.reason;
      publish();
      return;
    }
    if (c.loading) c.events.push(frame.event);
    else fold(c, frame.event);
    publish();
  });

  async function load() {
    publish({ loading: true, error: undefined });
    try {
      const agents = await api.listAgents();
      publish({ agents, loading: false });
      // Reopen the agent this machine was last using; a removed one falls back to the first row.
      const start = agents.find((row) => row.id === lastAgent) ?? agents[0];
      // Every row shows its latest conversation, so every agent's list is read; that boots each
      // runtime, the same as opening it would.
      for (const row of agents) if (row !== start) void listSessions(row.id);
      if (start) await selectAgent(start.id);
    } catch (error) {
      publish({ loading: false, error: message(error) });
    }
  }

  return {
    getSnapshot: () => view,
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
        note(error);
      }
    },
    open,
    /** Read on every opening of the picker: a `fastagent login` while duang runs needs no restart. */
    async loadModels() {
      const request = ++modelsRequest;
      publish({ models: undefined, modelsError: undefined });
      try {
        const models = await api.listModels();
        if (request === modelsRequest) publish({ models });
      } catch (error) {
        if (request === modelsRequest) publish({ modelsError: message(error) });
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
        note(error);
      }
    },
    async pickModel(model: string) {
      const id = view.agentId;
      const c = view.conversation;
      if (!id) return;
      const request = navigation;
      publish({ loading: true });
      try {
        const result = await api.setModel(id, model, c?.session);
        if (!result.ok) {
          publish({ loading: false });
          // The model did not change, so nothing ran: this is a refusal, not a failure.
          return refusal(result.error.message, c);
        }
        publish({ agents: await api.listAgents() });
        if (request !== navigation) return;
        if (c) close(c);
        publish({ loading: false, model, error: undefined, states: { ...view.states, [id]: "ready" } });
        if (c) await open(c.session);
        else await selectAgent(id);
      } catch (error) {
        if (request === navigation) {
          publish({ loading: false });
          note(error, c);
        }
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
        if (request === navigation) note(error);
      }
    },
    async reveal() {
      try {
        // No selected agent means the list itself is what failed; show that file instead.
        await (view.agentId ? api.revealAgent(view.agentId) : api.revealRegistry());
      } catch (error) {
        note(error);
      }
    },
    async removeAgent() {
      const id = view.agentId;
      if (!id) return;
      try {
        const result = await api.removeAgent(id);
        if (!result.ok) return note(result.error.message);
        for (const c of conversations.values()) if (c.agentId === id) close(c);
        for (const draftKey of [...drafts.keys()]) if (draftKey.startsWith(`${id}/`)) drafts.delete(draftKey);
        publish({ agents: await api.listAgents() });
        if (view.agentId !== id) return;
        ++navigation;
        const { [id]: _gone, ...rest } = view.sessions;
        publish({ agentId: undefined, conversation: undefined, error: undefined, sessions: rest });
        if (view.agents[0]) await selectAgent(view.agents[0].id);
      } catch (error) {
        note(error);
      }
    },
    /**
     * Names a conversation, in FastAgent, which owns the label. The list is re-read afterwards
     * rather than patched locally: the summary that matters is the one the runtime reports.
     */
    async renameSession(id: string, session: string, name: string) {
      const open = conversations.get(key(id, session));
      /**
       * A conversation nobody has opened has no transcript to put this in, and the window-wide
       * banner would offer a Retry for something else entirely. Its agent's row is where the
       * sidebar already says why a list is not what you expected.
       */
      const report = (text: string) => {
        if (open) note(text, open, "warning");
        else publish({ sessionsError: { ...view.sessionsError, [id]: text } });
      };
      try {
        const result = await api.renameSession(id, session, name);
        if (!result.ok) return report(result.error.message);
        // The name is FastAgent's now; re-read rather than patch, through the same ordered path
        // expanding uses, so a failed read is reported instead of leaving the old label in place.
        await listSessions(id);
      } catch (error) {
        report(message(error));
      }
    },
    /** The sidebar can delete a conversation of an agent that is not the open one, so it is named. */
    async deleteSession(id: string, session: string) {
      try {
        const result = await api.deleteSession(id, session);
        if (!result.ok) throw new Error(result.error.message);
        const c = conversations.get(key(id, session));
        if (c) close(c);
        drafts.delete(key(id, session));
        // The runtime confirmed the deletion, so the row goes whether or not this agent is the one
        // on screen — refreshList only ever looks at the open agent's list.
        publish({
          sessions: { ...view.sessions, [id]: (view.sessions[id] ?? []).filter((s) => s.session !== session) },
        });
        if (id !== view.agentId) return void (await readPreview(id));
        if (view.conversation?.session === session) await open(crypto.randomUUID());
        await refreshList(id);
      } catch (error) {
        note(error);
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
      // Steering: this message joined a run that was already going. Afterwards nothing else
      // distinguishes it from one that started a turn (§8), so the fact is recorded now.
      // A run in flight, not `busy(c)`: that predicate also covers compaction, and a message sent
      // while the context is being compacted starts a turn rather than joining one.
      const joining = c.state?.status === "running" || c.starting;
      const echo: UserItem = { kind: "user", text, at: Date.now(), steered: joining };
      if (joining) c.unlisted = [...c.unlisted, echo];
      else {
        c.items = [...c.items, echo];
        c.starting = true;
      }
      const runStarts = c.runStarts;
      const restoreRejected = () => {
        if (c.runStarts !== runStarts) return;
        c.items = c.items.filter((item) => item !== echo);
        c.unlisted = c.unlisted.filter((item) => item !== echo);
        c.draft = c.draft ? `${text}\n${c.draft}` : text;
      };
      c.sends++;
      publish();
      try {
        const result = await api.send(c.agentId, c.session, text);
        if (!result.ok) {
          // A run outcome already belongs to the transcript; only a rejected message returns to the draft.
          if (
            result.error.code !== "aborted" &&
            !c.items.some((item) => item.kind === "note" && item.text.includes(result.error.message))
          )
            refusal(result.error.message, c);
          restoreRejected();
        }
      } catch (error) {
        note(error, c);
        restoreRejected();
      } finally {
        // A turn that never started (refused, or failed before its run) leaves nothing to join.
        if (!joining && c.runStarts === runStarts) c.starting = false;
        c.sends--;
        publish();
      }
    },
    async abort() {
      const c = view.conversation;
      if (!c) return;
      try {
        const result = await api.abort(c.agentId, c.session);
        if (!result.ok) note(result.error.message, c);
      } catch (error) {
        note(error, c);
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
      unsubscribe();
      for (const c of conversations.values()) close(c);
      listeners.clear();
    },
  };
}

export type Store = ReturnType<typeof createStore>;
