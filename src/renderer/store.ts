import type { SessionEvent, SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, SessionFrame } from "../preload/index.ts";
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
  busySince?: number;
  sends: number;
  runStarts: number;
  events: SessionEvent[];
}
export interface View {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  sessions: SessionSummary[];
  model?: string;
  loading: boolean;
  error?: string;
  conversation?: Conversation;
  runningAgents: string[];
  runningSessions: string[];
}
const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

/** Runtime data stays in the runtime; this store owns selection, drafts and live, not-yet-durable output. */
export function createStore(api: DuangApi) {
  let view: View = { agents: [], states: {}, sessions: [], loading: false, runningAgents: [], runningSessions: [] };
  const listeners = new Set<() => void>();
  const conversations = new Map<string, Conversation>();
  const drafts = new Map<string, string>();
  let navigation = 0;
  let listRequest = 0;
  const key = (agentId: string, session: string) => `${agentId}/${session}`;
  const publish = (patch: Partial<View> = {}) => {
    view = { ...view, ...patch };
    const running = [...conversations.values()].filter(busy);
    view.runningAgents = [...new Set(running.map((c) => c.agentId))];
    view.runningSessions = running.filter((c) => c.agentId === view.agentId).map((c) => c.session);
    for (const listener of listeners) listener();
  };
  const note = (error: unknown, c = view.conversation) => {
    const text = error instanceof Error ? error.message : String(error);
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
  const leave = () => {
    const c = view.conversation;
    if (c && !busy(c)) close(c);
    publish({ conversation: undefined });
  };

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
      if (c.state.status === "running") c.busySince ??= Date.now();
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
    publish({ agentId: id, sessions: [], model: undefined, error: undefined, loading: true });
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
      c.busySince ??= event.timestamp;
    } else if (event.type === "run_settled") {
      c.state = { ...state, status: "idle", activeRunId: undefined, pending: { steering: 0, followUp: 0 } };
      c.busySince = undefined;
      void refreshList(c.agentId);
    } else if (event.type === "queue_changed") {
      c.state = { ...state, pending: data as unknown as SessionState["pending"] };
    } else if (event.type === "state_changed") {
      c.state = { ...state, ...data };
    } else if (event.type === "stream_failed") {
      c.error = String(data.reason);
      c.busySince = undefined;
    }
    c.items = apply(c.items, event);
  }
  const unsubscribe = api.onSessionEvent((frame: SessionFrame) => {
    const c = conversations.get(key(frame.agentId, frame.session));
    if (!c || c.subscription !== frame.subscription) return;
    if (c.loading) c.events.push(frame.event);
    else fold(c, frame.event);
    if (c !== view.conversation && !c.loading && !busy(c)) close(c);
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
        await api.setModel(id, model, c?.session);
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
        await api.removeAgent(id);
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
      if (!c || !text || c.loading || c.error || view.loading || view.states[c.agentId] !== "ready") return;
      c.draft = "";
      c.items = echoUser(c.items, text);
      const echo = c.items.at(-1);
      const runStarts = c.runStarts;
      const restoreRejected = () => {
        if (c.runStarts !== runStarts) return;
        c.items = c.items.filter((item) => item !== echo);
        c.draft = c.draft ? `${text}\n${c.draft}` : text;
      };
      c.busySince ??= Date.now();
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
        if (c.state?.status !== "running") c.busySince = undefined;
        if (c !== view.conversation && !busy(c)) close(c);
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
