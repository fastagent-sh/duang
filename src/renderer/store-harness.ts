import type { SessionEntry, SessionResult } from "@fastagent-sh/fastagent/session";
import type { Ending } from "../main/follow.ts";
import type { DuangApi, LoginOutcome, Models, LoginStep, OpenResult, ProviderRow, SessionFrame } from "../preload/index.ts";
import { createStore } from "./store.ts";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const described = (specs: string[]): Models => specs.map((spec) => ({ spec, thinkingLevels: ["off"] }));

// `satisfies`, not a type annotation: an imported binding is not narrowed to the literal, and the tests spread this one.
export const ready = { ok: true, model: "provider/model", sessions: [] } satisfies OpenResult;

export const listed = (session: string): OpenResult =>
  ({ ok: true, model: "provider/model", sessions: [{ session, updatedAt: 5, createdAt: 0, messageCount: 2 }] }) as never;
export const empty = () => ({
  state: { status: "idle" as const, pending: { steering: [], followUp: [] } },
  entries: { entries: [] },
});
export function harness() {
  let listener!: (frame: SessionFrame) => void;
  let stepListener!: (step: LoginStep) => void;
  const closed: string[] = [];
  const opens: string[] = [];
  const api: DuangApi = {
    listAgents: async () => [
      { id: "a", name: "A", dir: "/a", colour: 0 },
      { id: "b", name: "B", dir: "/b", colour: 1 },
    ],
    addAgent: async () => undefined,
    openAgent: async () => ready,
    setModel: async () => ({ ok: true }) as SessionResult,
    setThinking: async () => ({ ok: true }) as SessionResult,
    readState: async () => ({ status: "idle", pending: { steering: [], followUp: [] } }),
    removeAgent: async () => ({ ok: true }) as SessionResult,
    scaffoldAgent: async () => "/a/fastagent",
    relocateAgent: async () => undefined,
    resetAgentConfig: async () => ({ ok: true }),
    listCommands: async () => [],
    revealAgent: async () => {},
    revealRegistry: async () => {},
    listModels: async () => (described(["provider/model"])),
    refreshModels: async () => (described(["provider/model"])),
    providerUsage: async (provider) => ({ provider, fetchedAt: 0 }),
    openUsagePage: async () => {},
    getSettings: async () => ({ network: { mode: "automatic" }, avatar: "gaze" }),
    getRoute: async () => ({ source: "system" }),
    setNetwork: async () => ({ source: "system" }),
    setAvatar: async () => {},
    revealSettings: async () => {},
    testNetwork: async () => ({ status: 200, ms: 1, route: { source: "system" } }),
    onOpenSettings: () => () => {},
    setUnseenCount: async () => {},
    menu: async () => undefined,
    renameAgent: async () => {},
    renameSession: async () => ({ ok: true }),
    deleteSession: async () => ({ ok: true }),
    openSession: async (_id, session) => {
      opens.push(session);
      return empty();
    },
    readSession: async () => ({ entries: [] }),
    closeSession: async (subscription) => {
      closed.push(subscription);
    },
    send: async () => ({ ok: true }),
    abort: async () => ({ ok: true }),
    onSessionEvent: (fn) => {
      listener = fn;
      // Unregistering is real here, so a store that stops listening is seen to stop hearing.
      return () => {
        if (listener === fn) listener = () => {};
      };
    },
    listProviders: async () => [],
    revealProviders: async () => {},
    disconnect: async () => {},
    login: async () => ({ ok: true, verified: "n/a" }),
    answerLogin: async () => {},
    cancelLogin: async () => {},
    openLoginUrl: async () => {},
    onLoginStep: (fn) => {
      stepListener = fn;
      return () => {
        if (stepListener === fn) stepListener = () => {};
      };
    },
  };
  const store = createStore(api);
  const emit = (c: NonNullable<ReturnType<typeof store.getSnapshot>["conversation"]>, type: string, data = {}) => {
    listener({
      agentId: c.agentId,
      session: c.session,
      subscription: c.subscription,
      event: { type, data, timestamp: 1, runId: "run" },
    });
  };
  const end = (
    c: NonNullable<ReturnType<typeof store.getSnapshot>["conversation"]>,
    reason: string,
    why: Ending,
  ) => {
    listener({ agentId: c.agentId, session: c.session, subscription: c.subscription, ended: { reason, why } });
  };
  const step = (s: LoginStep) => stepListener(s);
  return { api, store, emit, end, step, closed, opens };
}

export function panes(store: ReturnType<typeof harness>["store"]) {
  const seen: string[] = [];
  const stop = store.subscribe(() => {
    const pane = store.getSnapshot().pane;
    if (seen.at(-1) !== pane) seen.push(pane);
  });
  return { seen, stop };
}
