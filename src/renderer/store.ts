import type { AgentCommand, SessionEvent, SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi, Models, SessionFrame } from "../preload/index.ts";
import { apply, fromEntries, type Item } from "./transcript.ts";

export type AgentState = "ready" | "missing_model" | "no_agent" | "broken";

/**
 * Where the window was last left. Navigation, not conversation data: the transcript belongs to the
 * runtime, and losing this only costs one click. So it is stored as best effort and never repaired
 * — anything unreadable is simply a first start.
 */
const SELECTION_KEY = "duang.selection";
const DRAFTS_KEY = "duang.drafts";
interface Selection {
  agentId?: string;
  perAgent: [string, string][];
}
/** Unsent text, kept until it is sent, cleared, or its conversation or agent goes away. */
function readDrafts(): [string, string][] {
  try {
    const stored = globalThis.localStorage?.getItem(DRAFTS_KEY);
    const parsed = stored ? (JSON.parse(stored) as [string, string][]) : undefined;
    return Array.isArray(parsed) ? parsed.filter(([k, v]) => typeof k === "string" && typeof v === "string") : [];
  } catch {
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
  /** Derived in `publish` from the busy transition, never assigned by the code that causes it. */
  busySince?: number;
  sends: number;
  runStarts: number;
  events: SessionEvent[];
}
export interface View {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  /** Conversations per agent: the sidebar can show more than the open agent's. */
  sessions: Record<string, SessionSummary[]>;
  /** Why an expanded agent has no list, per agent. An empty list and a failed one are not the same. */
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
  /** Selected agent's conversations holding unsent text, so a draft never becomes unreachable. */
  /** Conversations holding unsent text, per agent. */
  unsent: Record<string, string[]>;
  /**
   * Outcomes that landed while the person was not looking at that conversation, per agent. Fact 4:
   * runs are long and you come back to them, so "what happened while I was away" is the sidebar's
   * job. Opening the conversation clears it — like an unread mark, it exists to be spent.
   */
  unseen: Record<string, Record<string, "done" | "failed">>;
}
/** Two facts decide it: what we have in flight locally, and what the runtime says it is doing. */
/** [agentId, session] pairs into one list per agent. */
const group = (pairs: [string, string][]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [agentId, session] of pairs) (out[agentId] ??= []).push(session);
  return out;
};

const busy = (c: Conversation) => c.sends > 0 || c.state?.status === "running" || c.state?.status === "compacting";

/**
 * The sentence the other program wrote, and nothing of ours around it. Only unexpected failures
 * throw across IPC, and Electron wraps those as "Error invoking remote method 'x': Error: <what main
 * said>"; expected refusals arrive as values and never come through here.
 */
const message = (error: unknown): string =>
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

  async function refreshList(id: string) {
    if (id !== view.agentId) return;
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
      c.error = message(error);
      publish();
    }
  }

  async function selectAgent(id: string, session?: string) {
    const request = ++navigation;
    ++listRequest;
    leave();
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
    const state = c.state ?? { status: "idle", pending: { steering: 0, followUp: 0 } };
    const data = event.data as Record<string, unknown>;
    if (event.type === "run_started") {
      c.runStarts++;
      c.state = { ...state, status: "running", activeRunId: event.runId };
    } else if (event.type === "run_settled") {
      c.state = { ...state, status: "idle", activeRunId: undefined, pending: { steering: 0, followUp: 0 } };
      // A run that ends while you are reading something else is the thing you came back for. A run
      // you stopped yourself is not news.
      if (c !== view.conversation && data.status !== "aborted")
        unseen.set(key(c.agentId, c.session), data.status === "completed" ? "done" : "failed");
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
      // Reopen the agent this machine was last using; a removed one falls back to the first row.
      const start = agents.find((row) => row.id === lastAgent) ?? agents[0];
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
     * Conversations for an agent the sidebar expanded but did not open. This boots that agent's
     * runtime, the same as opening it would: FastAgent owns the session list, and duang will not
     * keep a second copy of where sessions live.
     *
     * A failure belongs to the agent that was expanded, never to the transcript being read, so it
     * is published against that agent and the sidebar says it there. It deliberately does not touch
     * `states`: that drives the main panel, and a fold-and-expand of the open agent would otherwise
     * put the window into "this agent is broken" with no message to show for it.
     */
    async listSessions(id: string) {
      const request = (listRequests.get(id) ?? 0) + 1;
      listRequests.set(id, request);
      const settle = (patch: Partial<View>) => {
        if (listRequests.get(id) === request) publish(patch);
      };
      try {
        const result = await api.openAgent(id);
        if (!result.ok) return settle({ sessionsError: { ...view.sessionsError, [id]: result.message } });
        const { [id]: _cleared, ...errors } = view.sessionsError;
        settle({ sessions: { ...view.sessions, [id]: result.sessions }, sessionsError: errors });
      } catch (error) {
        settle({ sessionsError: { ...view.sessionsError, [id]: message(error) } });
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
      // Steering: this message joined a run that was already going. Afterwards nothing else
      // distinguishes it from one that started a turn (§8), so the fact is recorded now.
      c.items = [...c.items, { kind: "user", text, at: Date.now(), steered: busy(c) }];
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
            refusal(result.error.message, c);
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

export type Store = ReturnType<typeof createStore>;
