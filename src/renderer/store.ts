import type { AgentCommand, SessionEvent, SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, Models, SessionFrame } from "../preload/index.ts";
import { apply, echoUser, fromEntries, type Item } from "./transcript.ts";

export type AgentState = "ready" | "missing_model" | "no_agent" | "broken";
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
  /** Derived in `publish` from the busy transition, never assigned by the code that causes it. */
  busySince?: number;
  sends: number;
  runStarts: number;
  events: SessionEvent[];
}
interface View {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  sessions: SessionSummary[];
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
  runningAgents: string[];
  runningSessions: string[];
}
/** Two facts decide it: what we have in flight locally, and what the runtime says it is doing. */
const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

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
    sessions: [],
    loading: false,
    busy: false,
    commands: [],
    runningAgents: [],
    runningSessions: [],
  };
  const listeners = new Set<() => void>();
  const conversations = new Map<string, Conversation>();
  const drafts = new Map<string, string>();
  let navigation = 0;
  let listRequest = 0;
  let modelsRequest = 0;
  let commandsFor: string | undefined;
  const key = (agentId: string, session: string) => `${agentId}/${session}`;
  const publish = (patch: Partial<View> = {}) => {
    view = { ...view, ...patch };
    // One transition point for both derived facts: the wait clock, and how long a view keeps its
    // subscription. Every way a turn can end passes through here, so no ending path has to remember.
    for (const c of conversations.values()) {
      if (busy(c)) c.busySince ??= Date.now();
      else {
        c.busySince = undefined;
        // A conversation nobody is looking at is retained only while it can still produce something
        // this view needs: its own backfill, or a turn in flight.
        if (c !== view.conversation && !c.loading) close(c);
      }
    }
    const running = [...conversations.values()].filter(busy);
    view.busy = !!view.conversation && busy(view.conversation);
    view.runningAgents = [...new Set(running.map((c) => c.agentId))];
    view.runningSessions = running.filter((c) => c.agentId === view.agentId).map((c) => c.session);
    view.blocked = blockedBy(view);
    for (const listener of listeners) listener();
  };
  const note = (error: unknown, c = view.conversation) => {
    // Only unexpected failures throw across IPC now, and Electron wraps those as
    // "Error invoking remote method 'x': Error: <what main said>". Expected refusals arrive as values.
    const text = (error instanceof Error ? error.message : String(error)).replace(
      /^Error invoking remote method '[^']*': (Error: )?/,
      "",
    );
    if (c) {
      c.items = [...c.items, { kind: "note", text }];
      publish();
    } else publish({ error: text });
  };
  const close = (c: Conversation) => {
    drafts.set(key(c.agentId, c.session), c.draft);
    if (conversations.get(key(c.agentId, c.session)) === c) conversations.delete(key(c.agentId, c.session));
    void api.closeSession(c.subscription).catch((error) => note(error));
  };
  const leave = () => publish({ conversation: undefined });

  async function refreshList(id: string) {
    if (id !== view.agentId) return;
    const request = ++listRequest;
    try {
      const result = await api.openAgent(id);
      if (id !== view.agentId || request !== listRequest) return;
      if (!result.ok) throw new Error(result.message);
      publish({ sessions: result.sessions, model: result.model });
    } catch (error) {
      if (id === view.agentId && request === listRequest) note(error);
    }
  }

  async function open(session: string) {
    const agentId = view.agentId;
    if (!agentId) return;
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
    };
    conversations.set(key(agentId, session), c);
    publish({ conversation: c, error: undefined });
    try {
      const result = await api.openSession(agentId, session, c.subscription);
      if (conversations.get(key(agentId, session)) !== c) return;
      c.items = fromEntries(result.entries.entries, result.entries.leafEntryId);
      c.state = result.state;
      c.loading = false;
      // New sends are disabled until backfill finishes. An already-running local turn retains its
      // subscription and view across navigation, so its deltas are never reconstructed from history.
      for (const event of c.events) fold(c, event);
      c.events = [];
      publish();
    } catch (error) {
      if (conversations.get(key(agentId, session)) !== c) return;
      c.loading = false;
      c.error = String(error);
      publish();
    }
  }

  async function selectAgent(id: string) {
    const request = ++navigation;
    ++listRequest;
    leave();
    // The command names belong to the agent's definition, so they do not survive the switch.
    commandsFor = undefined;
    publish({
      agentId: id,
      sessions: [],
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
        sessions: result.sessions,
        states: { ...view.states, [id]: "ready" },
      });
      const newest = [...result.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const running = [...conversations.values()].find((c) => c.agentId === id && busy(c));
      await open(running?.session ?? newest?.session ?? crypto.randomUUID());
    } catch (error) {
      if (request === navigation)
        publish({ loading: false, error: String(error), states: { ...view.states, [id]: "broken" } });
    }
  }

  function fold(c: Conversation, event: SessionEvent) {
    const state = c.state ?? { status: "idle", pending: { steering: 0, followUp: 0 } };
    const data = event.data as Record<string, unknown>;
    if (event.type === "run_started") {
      c.runStarts++;
      c.state = { ...state, status: "running", activeRunId: event.runId };
    } else if (event.type === "run_settled") {
      c.state = { ...state, status: "idle", activeRunId: undefined, pending: { steering: 0, followUp: 0 } };
      void refreshList(c.agentId);
    } else if (event.type === "queue_changed") {
      c.state = { ...state, pending: data as unknown as SessionState["pending"] };
    } else if (event.type === "state_changed") {
      c.state = { ...state, ...data };
    }
    c.items = apply(c.items, event);
  }
  const unsubscribe = api.onSessionEvent((frame: SessionFrame) => {
    const c = conversations.get(key(frame.agentId, frame.session));
    if (!c || c.subscription !== frame.subscription) return;
    if (frame.ended) {
      // Nothing will report the end of a run this view can no longer hear, so stop waiting for one.
      // Retry re-opens and re-reads the runtime's real state.
      if (c.state) c.state = { ...c.state, status: "idle", activeRunId: undefined };
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
      if (agents[0]) await selectAgent(agents[0].id);
    } catch (error) {
      publish({ loading: false, error: String(error) });
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
    open,
    /** Read on every opening of the picker: a `fastagent login` while duang runs needs no restart. */
    async loadModels() {
      const request = ++modelsRequest;
      publish({ models: undefined, modelsError: undefined });
      try {
        const models = await api.listModels();
        if (request === modelsRequest) publish({ models });
      } catch (error) {
        if (request === modelsRequest) publish({ modelsError: String(error) });
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
          publish({ commandsError: String(error) });
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
          return note(result.error.message, c);
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
      if (!view.agentId) return;
      try {
        await api.revealAgent(view.agentId);
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
        publish({ agents: await api.listAgents() });
        if (view.agentId !== id) return;
        ++navigation;
        publish({ agentId: undefined, conversation: undefined, error: undefined, sessions: [] });
        if (view.agents[0]) await selectAgent(view.agents[0].id);
      } catch (error) {
        note(error);
      }
    },
    async deleteSession(session: string) {
      const id = view.agentId;
      if (!id) return;
      try {
        const result = await api.deleteSession(id, session);
        if (!result.ok) throw new Error(result.error.message);
        const c = conversations.get(key(id, session));
        if (c) close(c);
        drafts.delete(key(id, session));
        if (id !== view.agentId) return;
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
      c.items = echoUser(c.items, text);
      const echo = c.items.at(-1);
      const runStarts = c.runStarts;
      const restoreRejected = () => {
        if (c.runStarts !== runStarts) return;
        c.items = c.items.filter((item) => item !== echo);
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
            note(result.error.message, c);
          restoreRejected();
        }
      } catch (error) {
        note(error, c);
        restoreRejected();
      } finally {
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
