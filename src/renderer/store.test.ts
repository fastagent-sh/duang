import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry, SessionResult } from "@fastagent-sh/fastagent/session";
import type { Ending } from "../main/follow.ts";
import type { DuangApi, LoginOutcome, Models, LoginStep, OpenResult, ProviderRow, SessionFrame } from "../preload/index.ts";
import { keyStep } from "./settings-store.ts";
import { createStore } from "./store.ts";
import { queueView } from "./transcript.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Models as FastAgent describes them, by spec only: what these tests are about. */
const described = (specs: string[]): Models => specs.map((spec) => ({ spec, thinkingLevels: ["off"] }));
const ready: OpenResult = { ok: true, model: "provider/model", sessions: [] };
const listed = (session: string): OpenResult =>
  ({ ok: true, model: "provider/model", sessions: [{ session, updatedAt: 5, createdAt: 0, messageCount: 2 }] }) as never;
const empty = () => ({
  state: { status: "idle" as const, pending: { steering: [], followUp: [] } },
  entries: { entries: [] },
});
function harness() {
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

/** Every pane the store showed, in order, without repeats. */
function panes(store: ReturnType<typeof harness>["store"]) {
  const seen: string[] = [];
  const stop = store.subscribe(() => {
    const pane = store.getSnapshot().pane;
    if (seen.at(-1) !== pane) seen.push(pane);
  });
  return { seen, stop };
}

test("an agent's existing conversation opens straight into it, never by way of the new-conversation page", async () => {
  const { api, store } = harness();
  api.openAgent = async () => listed("s1");
  const history = deferred<ReturnType<typeof empty>>();
  api.openSession = () => history.promise as never;
  const { seen, stop } = panes(store);
  const loading = store.load();
  await new Promise((resolve) => setImmediate(resolve));
  history.resolve({
    ...empty(),
    entries: { entries: [{ id: "a1", timestamp: 1, kind: "assistant", data: { text: "done" } }] } as never,
  });
  await loading;
  stop();
  assert.deepEqual(seen, ["no-agents", "settling", "transcript"], "the agent list, then the agent opening, then its conversation");
  store.dispose();
});

test("a new conversation is the start page, and the model being changed is said as that, not as opening", async () => {
  const { api, store } = harness();
  await store.load();
  assert.equal(store.getSnapshot().pane, "start", "an agent with no conversations starts a new one");
  const change = deferred<SessionResult>();
  api.setModel = () => change.promise;
  const picking = store.pickModel("provider/other");
  assert.equal(store.getSnapshot().blocked, "changing the model…");
  assert.equal(store.getSnapshot().pane, "start", "the conversation stays on screen");
  change.resolve({ ok: true } as SessionResult);
  await picking;
  assert.equal(store.getSnapshot().changingModel, undefined);
  assert.equal(store.getSnapshot().blocked, undefined);
  store.dispose();
});

test("a model change still running when the person goes to another agent does not hold that agent", async () => {
  const { api, store } = harness();
  await store.load();
  const change = deferred<SessionResult>();
  api.setModel = () => change.promise;
  const picking = store.pickModel("provider/other");
  await store.selectAgent("b");
  assert.equal(store.getSnapshot().blocked, undefined, "b can be used while a's model is set up");
  change.resolve({ ok: true } as SessionResult);
  await picking;
  await store.selectAgent("a");
  assert.equal(store.getSnapshot().blocked, undefined, "and a is not left changing for good");
  store.dispose();
});

test("an unreadable agent list is its own pane; a failure adding an agent is said above the pane, not that pane", async () => {
  const { api, store } = harness();
  api.listAgents = async () => {
    throw new Error("agents.json: Unexpected token");
  };
  await store.load();
  assert.equal(store.getSnapshot().pane, "unreadable-registry");
  assert.equal(store.getSnapshot().registryError, "agents.json: Unexpected token");
  assert.equal(store.getSnapshot().alert, undefined, "the page says it; nothing over it repeats it");

  api.listAgents = async () => [];
  await store.load();
  assert.equal(store.getSnapshot().pane, "no-agents");
  api.addAgent = async () => {
    throw new Error("ENOENT: no such file or directory, realpath '/gone'");
  };
  await store.addAgent();
  assert.equal(store.getSnapshot().pane, "no-agents", "adding failed; the list itself was read fine");
  assert.equal(store.getSnapshot().failure?.title, "The agent was not added");
  assert.match(store.getSnapshot().failure?.reason ?? "", /realpath/);
  store.dismissFailure();
  assert.equal(store.getSnapshot().failure, undefined);
  store.dispose();
});

test("a setup problem is its own pane, and its prose is not repeated above it", async () => {
  const { api, store } = harness();
  api.openAgent = async () => ({ ok: false, code: "broken", message: "boom" });
  await store.load();
  assert.equal(store.getSnapshot().pane, "broken");
  assert.equal(store.getSnapshot().error, "boom", "the panel says it");
  assert.equal(store.getSnapshot().alert, undefined);
  api.openAgent = async () => ({ ok: false, code: "no_agent", message: "run fastagent init" });
  await store.selectAgent("b");
  assert.equal(store.getSnapshot().pane, "no-agent");
  assert.equal(store.getSnapshot().alert, undefined);
  store.dispose();
});

test("an agent with no default opens on its latest conversation; only a new one with no model asks for one", async () => {
  const { api, store } = harness();
  // No default model: the agent opens all the same, and its conversation runs on the model it recorded.
  api.openAgent = async () => ({ ok: true, sessions: [{ session: "older", updatedAt: 5, createdAt: 0, messageCount: 2 }] }) as never;
  api.openSession = async (_id, session) =>
    session === "older" ? { ...empty(), state: { ...empty().state, model: "provider/model" } } : empty();
  await store.load();
  assert.equal(store.getSnapshot().conversation?.session, "older", "straight to its history, no model asked for");
  assert.equal(store.getSnapshot().blocked, undefined);
  // A new conversation records no model and has no default to fall back on: it asks.
  await store.newConversation();
  const fresh = store.getSnapshot().conversation!;
  assert.notEqual(fresh.session, "older");
  assert.equal(store.getSnapshot().blocked, "pick a model to start");
  // Chosen there, it runs on it, and the page stays the one the model was chosen on.
  api.readState = async () => ({ status: "idle", pending: { steering: [], followUp: [] }, model: "provider/model" });
  api.openAgent = async () => listed("older");
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().conversation, fresh);
  assert.equal(store.getSnapshot().blocked, undefined, "the one rule that disables the composer");
  store.dispose();
});

test("a store that React disposes and loads again still hears its conversations and sign-ins", async () => {
  // Fast Refresh runs the App effect's cleanup and setup again on the same store, on every edit in
  // development. The second setup must register for what main pushes again, or every run looks
  // stuck and a sign-in never shows what its flow asks.
  const { api, store, emit, step } = harness();
  await store.load();
  store.dispose();
  await store.load();
  const c = store.getSnapshot().conversation!;
  assert.equal(c.loading, false);
  emit(c, "run_started");
  assert.equal(store.getSnapshot().busy, true, "the run the runtime reported is shown as running");
  const provider: ProviderRow = { id: "p", name: "P", ways: [{ method: "api_key", label: "P key", subscription: false }] };
  const done = deferred<LoginOutcome>();
  api.login = () => done.promise;
  const connecting = store.connect(provider, provider.ways[0]!);
  step({ type: "prompt", id: "1", prompt: { type: "secret", message: "Key" } });
  assert.equal(store.getSnapshot().signIn?.prompt?.id, "1", "the flow's question reaches the sign-in");
  done.resolve({ ok: false, cancelled: true });
  await connecting;
  store.dispose();
});

test("late agent and conversation reads cannot replace the current selection", async () => {
  const { api, store } = harness();
  const agent = deferred<OpenResult>();
  api.openAgent = async (id) => (id === "a" ? agent.promise : ready);
  const old = store.selectAgent("a");
  await store.selectAgent("b");
  agent.resolve({ ok: false, code: "broken", message: "stale failure" });
  await old;
  assert.equal(store.getSnapshot().agentId, "b");
  assert.equal(store.getSnapshot().error, undefined);
  const snapshot = deferred<ReturnType<typeof empty>>();
  api.openSession = async (_id, session) => (session === "old" ? snapshot.promise : empty());
  const oldSession = store.open("old");
  await store.open("new");
  snapshot.resolve(empty());
  await oldSession;
  assert.equal(store.getSnapshot().conversation?.session, "new");
  store.dispose();
});

test("drafts stay with conversations; rejected sends preserve text and report the original error", async () => {
  const { api, store } = harness();
  await store.load();
  await store.open("one");
  store.setDraft("unsent first");
  await store.open("two");
  store.setDraft("unsent second");
  await store.open("one");
  assert.equal(store.getSnapshot().conversation?.draft, "unsent first");
  api.send = async () => {
    throw new Error("original IPC failure");
  };
  await store.send();
  const c = store.getSnapshot().conversation!;
  assert.equal(c.draft, "unsent first");
  assert.equal(store.getSnapshot().busy, false);
  assert.ok(
    c.items.every((item) => item.kind !== "user"),
    "a refused send must not look delivered",
  );
  assert.ok(c.items.some((item) => item.kind === "note" && item.text === "original IPC failure"));
  await store.open("two");
  assert.equal(store.getSnapshot().conversation?.draft, "unsent second");
  store.dispose();
});

test("a rejected send returns its text without eating what was typed meanwhile", async () => {
  const { api, store } = harness();
  await store.load();
  await store.open("one");
  const refusal = deferred<SessionResult>();
  api.send = () => refusal.promise;
  store.setDraft("first message");
  const sending = store.send();
  // The person does not wait for admission; they start the next line while it is still pending.
  store.setDraft("typed while waiting");
  refusal.resolve({ ok: false, error: { code: "refused", message: "no", retryable: true } });
  await sending;
  assert.equal(store.getSnapshot().conversation?.draft, "first message\ntyped while waiting");
  store.dispose();
});

test("unreadable drafts are moved aside, not overwritten by the next write", async () => {
  const values = new Map<string, string>([["duang.drafts", "{not json"]]);
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) },
    configurable: true,
  });
  const error = console.error;
  console.error = () => {};
  try {
    const { store } = harness();
    await store.load();
    store.setDraft("new text");
    assert.equal(values.get("duang.drafts.unreadable"), "{not json", "the person's old text survives the write");
    assert.match(values.get("duang.drafts") ?? "", /new text/);
    store.dispose();
  } finally {
    console.error = error;
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("a conversation opened mid-run shows its unanswered calls as running, not stopped", async () => {
  const { api, store } = harness();
  const entries: SessionEntry[] = [
    { id: "u", timestamp: 1, kind: "user", data: { text: "go" } },
    { id: "a", parentId: "u", timestamp: 2, kind: "assistant", data: { toolCalls: [{ id: "t", name: "bash" }] } },
  ];
  api.openSession = async () => ({
    state: { status: "running" as const, activeRunId: "run", pending: { steering: [], followUp: [] } },
    entries: { entries, leafEntryId: "a" },
  });
  await store.load();
  const tool = store.getSnapshot().conversation!.items.find((item) => item.kind === "tool");
  assert.equal(tool?.kind === "tool" && tool.status, "running");
  assert.equal(tool?.kind === "tool" && tool.started, undefined, "when it began is not in history");
  store.dispose();
});

test("a restart reopens the agent and conversation the window was left on", async () => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  try {
    const first = harness();
    first.api.openAgent = async () => listed("kept");
    await first.store.load();
    await first.store.selectAgent("b");
    await first.store.open("kept");
    first.store.dispose();

    const second = harness();
    second.api.openAgent = async () => listed("kept");
    await second.store.load();
    assert.equal(second.store.getSnapshot().agentId, "b");
    assert.equal(second.store.getSnapshot().conversation?.session, "kept");
    second.store.setDraft("typed before quitting");
    second.store.dispose();

    // Unsent text survives the restart too, and stops existing once it is cleared.
    const third = harness();
    third.api.openAgent = async () => listed("kept");
    await third.store.load();
    assert.equal(third.store.getSnapshot().conversation?.draft, "typed before quitting");
    assert.deepEqual(third.store.getSnapshot().unsent["b"] ?? [], ["kept"]);
    third.store.setDraft("");
    third.store.dispose();

    const fourth = harness();
    fourth.api.openAgent = async () => listed("kept");
    await fourth.store.load();
    assert.equal(fourth.store.getSnapshot().conversation?.draft, "");
    assert.deepEqual(fourth.store.getSnapshot().unsent["b"] ?? [], []);
    fourth.store.dispose();
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("an unsent conversation keeps a row, so leaving it is not discarding it", async () => {
  const { store } = harness();
  await store.load();
  await store.open("unsent");
  store.setDraft("typed but never sent");
  await store.selectAgent("b");
  // Per agent, so switching away does not hide it: it belongs to A's list, not to whatever is open.
  assert.deepEqual(store.getSnapshot().unsent, { a: ["unsent"] });
  await store.selectAgent("a");
  assert.deepEqual(store.getSnapshot().unsent["a"] ?? [], ["unsent"]);
  assert.equal(store.getSnapshot().conversation?.session, "unsent", "returning lands where you left");
  assert.equal(store.getSnapshot().conversation?.draft, "typed but never sent");
  store.setDraft("");
  await store.open("other");
  assert.deepEqual(store.getSnapshot().unsent["a"] ?? [], [], "an emptied draft leaves no row behind");
  store.dispose();
});

test("a failure is shown as the sentence main wrote, wherever it lands", async () => {
  const { api, store } = harness();
  await store.load();
  const wrapped = new Error("Error invoking remote method 'session:open': Error: no such session");
  api.openSession = async () => {
    throw wrapped;
  };
  await store.open("gone");
  assert.equal(store.getSnapshot().conversation?.error?.reason, "no such session");
  assert.equal(store.getSnapshot().alert?.title, "This conversation could not be opened");
  api.openSession = async () => empty();
  api.send = async () => {
    throw wrapped;
  };
  await store.retry();
  store.setDraft("hi");
  await store.send();
  const notes = store.getSnapshot().conversation?.items.filter((item) => item.kind === "note");
  const last = notes?.at(-1);
  assert.equal(last?.kind === "note" && last.reason, "no such session", "the strip and the transcript keep main's words");
  assert.equal(last?.kind === "note" && last.title, "The message could not be sent");
  store.dispose();
});

test("background turns retain their stream and transcript, then release it after settlement", async () => {
  const { api, store, emit, closed, opens } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => sent.promise;
  store.setDraft("hello");
  const sending = store.send();
  emit(c, "run_started");
  emit(c, "queue_changed", { steering: ["queued elsewhere"], followUp: [] });
  assert.deepEqual(c.state?.pending.steering, ["queued elsewhere"]);
  await store.newConversation();
  assert.deepEqual(store.getSnapshot().running["a"] ?? [], [c.session], "the running conversation is named under its agent");
  assert.equal(closed.includes(c.subscription), false);
  emit(c, "message_delta", { channel: "text", delta: "background answer" });
  const count = opens.length;
  await store.open(c.session);
  assert.equal(opens.length, count, "a live view is reused, not backfilled over its own deltas");
  assert.ok(c.items.some((item) => item.kind === "assistant" && item.text === "background answer"));
  emit(c, "run_settled", { status: "completed" });
  assert.equal(closed.includes(c.subscription), false, "a send still in flight keeps the subscription");
  sent.resolve({ ok: true });
  await sending;
  assert.equal(c.state?.status, "idle");
  assert.deepEqual(c.state?.pending.steering, []);
  assert.equal(store.getSnapshot().busy, false);
  await store.newConversation();
  assert.ok(closed.includes(c.subscription), "an idle conversation nobody is looking at releases its stream");
  store.dispose();
});

test("settlement in another agent cannot invalidate the visible agent's list refresh", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const a = store.getSnapshot().conversation!;
  emit(a, "run_started");
  await store.selectAgent("b");
  const b = store.getSnapshot().conversation!;
  const refreshed = deferred<OpenResult>();
  api.openAgent = async (id) => (id === "b" ? refreshed.promise : ready);
  emit(b, "run_settled", { status: "completed" });
  emit(a, "run_settled", { status: "completed" });
  refreshed.resolve({
    ...ready,
    sessions: [{ session: "b-saved", preview: "B's turn", createdAt: 0, updatedAt: 1, messageCount: 2 }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().sessions["b"]?.[0]?.session, "b-saved");
  store.dispose();
});

test("failed delete and abort remain visible; a stale stream never changes a reopened session", async () => {
  const { api, store, emit, end, opens } = harness();
  await store.load();
  const old = store.getSnapshot().conversation!;
  const refusal = { ok: false as const, error: { code: "busy", message: "runtime refused", retryable: true } };
  api.deleteSession = async () => refusal;
  api.abort = async () => refusal;
  await store.deleteSession(old.agentId, old.session);
  assert.equal(store.getSnapshot().conversation, old);
  await store.abort();
  assert.ok(old.items.some((item) => item.kind === "note" && item.text === "runtime refused"));
  await store.retry(); // closes the subscription and opens the conversation again
  const current = store.getSnapshot().conversation!;
  emit(old, "message_delta", { delta: "stale" });
  assert.deepEqual(current.items, []);
  emit(current, "run_started");
  emit(current, "tool_started", { id: "t", name: "bash" });
  assert.equal(store.getSnapshot().busy, true);
  // A failed stream is said, and waits for the person; a dead subscription reports nothing further, so the
  // run controls must not wait for `run_settled`.
  const opened = opens.length;
  end(current, "stream disconnected", "failed");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opens.length, opened, "only a subscriber the runtime let go is listened to again by itself");
  assert.equal(store.getSnapshot().busy, false);
  const tool = store.getSnapshot().conversation!.items.find((item) => item.kind === "tool");
  assert.notEqual(tool?.kind === "tool" && tool.ended, undefined, "the tool's clock stops with the stream");
  store.setDraft("keep me");
  assert.equal(store.getSnapshot().blocked, "reconnect before sending");
  await assert.rejects(() => store.send(), /reconnect before sending/, "a blocked send is a bug, not a no-op");
  assert.equal(current.draft, "keep me");
  assert.equal(current.error?.reason, "stream disconnected");
  assert.equal(current.error?.title, "The live connection to this conversation was lost");
  await store.retry();
  assert.equal(store.getSnapshot().conversation?.draft, "keep me");
  assert.equal(store.getSnapshot().conversation?.error, undefined);
  store.dispose();
});

test("a subscriber the runtime let go listens again once by itself; any other end is said", async () => {
  const { store, emit, end, opens } = harness();
  await store.load();
  const opened = opens.length;
  end(store.getSnapshot().conversation!, "Its runtime let this subscriber go", "let_go");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opens.length, opened + 1, "listened to again: FastAgent's contract for a subscriber it let go");
  const c = store.getSnapshot().conversation!;
  assert.equal(c.ended, undefined, "and nothing is said about it");
  emit(c, "run_started");
  end(c, "Its runtime let this subscriber go", "let_go");
  assert.equal(opens.length, opened + 1, "not reconnected in a loop");
  const current = store.getSnapshot().conversation!;
  assert.equal(current.ended, "Its runtime let this subscriber go");
  assert.equal(current.error, undefined, "an intended end is not a failure");
  assert.ok(
    current.items.every((item) => item.kind !== "note"),
    "and it does not write itself into the transcript",
  );
  assert.equal(store.getSnapshot().busy, false, "a deaf view must stop waiting for run_settled");
  store.setDraft("blocked");
  assert.equal(store.getSnapshot().blocked, "reconnect before sending");
  await assert.rejects(() => store.send(), /reconnect before sending/);
  assert.equal(current.draft, "blocked", "sending waits for the reconnect");
  await store.retry();
  assert.equal(store.getSnapshot().conversation?.ended, undefined);

  // duang ending it (the agent was removed) is not answered by opening it again.
  const before = opens.length;
  end(store.getSnapshot().conversation!, "The agent was removed", "ended");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opens.length, before, "a removed agent is not reopened");
  assert.equal(store.getSnapshot().conversation?.ended, "The agent was removed");
  store.dispose();

  // Nor while a send is still answering: a refusal puts its words back in the composer that reopening replaces.
  const second = harness();
  await second.store.load();
  const sent = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  second.api.send = () => sent.promise;
  second.store.setDraft("my message");
  const sending = second.store.send();
  const waiting = second.opens.length;
  second.end(second.store.getSnapshot().conversation!, "Its runtime let this subscriber go", "let_go");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.opens.length, waiting, "not reopened under a send");
  sent.resolve({ ok: false, error: { code: "busy", message: "runtime refused", retryable: true } });
  await sending;
  assert.equal(second.store.getSnapshot().conversation?.draft, "my message", "the refused words are where the person sees them");
  second.store.dispose();
});

test("a config that failed to load is offered afresh once, however often the button is pressed", async () => {
  const { api, store } = harness();
  api.openAgent = async () => ({ ok: false, code: "broken", message: "/p/fastagent/fastagent.config.ts: Expression expected", inConfig: true });
  await store.load();
  assert.equal(store.getSnapshot().errorInConfig, true, "main says the failure is in the config");
  const reset = deferred<SessionResult>();
  let calls = 0;
  api.resetAgentConfig = () => (calls++, reset.promise);
  const first = store.resetConfig();
  const second = store.resetConfig();
  reset.resolve({ ok: true });
  await Promise.all([first, second]);
  assert.equal(calls, 1, "a double click is one reset");
  store.dispose();
});

test("an agent whose default model pi does not know opens, with the picker open on it, until another is chosen", async () => {
  const { api, store } = harness();
  api.openAgent = async (id) =>
    id === "a" ? { ok: true, sessions: [], model: "provider/model", staleModel: "local/gone" } : { ok: true, sessions: [], model: "provider/model" };
  await store.load();
  assert.equal(store.getSnapshot().pane, "start", "the agent opens on its own model");
  assert.deepEqual(store.getSnapshot().staleDefault, { agentId: "a", model: "local/gone" });
  assert.equal(store.getSnapshot().picker, true, "a model is asked for, though the agent has one to run");
  await store.selectAgent("b");
  assert.equal(store.getSnapshot().staleDefault, undefined, "another agent's default is fine");
  await store.selectAgent("a");
  assert.equal(store.getSnapshot().picker, true, "and asked again on coming back while it is still gone");
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().staleDefault, undefined, "a chosen model is the default now");
  store.dispose();
});

test("a refused model change or removal is shown, and changes nothing", async () => {
  const { api, store } = harness();
  await store.load();
  const before = store.getSnapshot();
  const c = before.conversation!;
  const busy: SessionResult = {
    ok: false,
    error: { code: "agent_busy", message: "An agent conversation is running", retryable: true },
  };
  api.setModel = async () => busy;
  api.removeAgent = async () => busy;
  await store.pickModel("provider/other");
  assert.equal(store.getSnapshot().model, "provider/model", "the chip keeps the model that is actually loaded");
  assert.equal(store.getSnapshot().conversation, c, "a refusal does not tear down the conversation");
  assert.equal(store.getSnapshot().loading, false);
  await store.removeAgent();
  assert.equal(store.getSnapshot().agentId, "a");
  const notes = c.items.filter((item) => item.kind === "note" && item.text === "An agent conversation is running");
  assert.equal(notes.length, 1, "the model refusal is the conversation's own, verbatim");
  assert.deepEqual(
    store.getSnapshot().failure,
    { title: "The agent was not removed", reason: "An agent conversation is running" },
    "the agent's removal is not the conversation's",
  );
  store.dispose();
});

test("the roster is first drawn in the avatar style already chosen, not the default and then that", async () => {
  const { api, store } = harness();
  const style = deferred<"moods">();
  api.getSettings = async () => ({ network: { mode: "automatic" }, avatar: await style.promise });
  const drawn: string[] = [];
  const stop = store.subscribe(() => {
    const view = store.getSnapshot();
    if (view.agents.length) drawn.push(view.avatar);
  });
  const loading = store.load();
  await new Promise((resolve) => setImmediate(resolve));
  style.resolve("moods");
  await loading;
  stop();
  assert.ok(drawn.length > 0, "the roster was drawn");
  assert.ok(drawn.every((avatar) => avatar === "moods"), `every drawing of the roster wore the chosen style: ${[...new Set(drawn)]}`);
  store.dispose();
});

test("an unreadable settings file leaves the default style and does not stop the roster", async () => {
  const { api, store } = harness();
  api.getSettings = async () => {
    throw new Error("settings.json: Unexpected token");
  };
  await store.load();
  assert.equal(store.getSnapshot().avatar, "gaze");
  assert.equal(store.getSnapshot().agents.length, 2, "the agents still load");
  store.dispose();
});

test("refreshing models does nothing until the list has arrived", async () => {
  const { api, store } = harness();
  await store.load();
  const slow = deferred<Models>();
  let refreshed = 0;
  api.listModels = () => slow.promise;
  api.refreshModels = async () => {
    refreshed++;
    throw new Error("could not refresh");
  };
  const loading = store.loadModels();
  await store.refreshModels();
  assert.equal(refreshed, 0, "nothing was asked: the picker is still loading");
  assert.equal(store.getSnapshot().modelsRefresh, undefined);
  slow.resolve(described(["provider/model"]));
  await loading;
  assert.deepEqual(store.getSnapshot().models?.map((model) => model.spec), ["provider/model"], "the reading in flight still lands");
  store.dispose();
});

test("opening the conversation that is already open changes nothing", async () => {
  const { store, opens } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const seen: unknown[] = [];
  const stop = store.subscribe(() => seen.push(store.getSnapshot().conversation));
  const opened = opens.length;
  await store.open(c.session);
  stop();
  assert.equal(store.getSnapshot().conversation, c, "the same conversation, not a rebuilt one");
  assert.ok(seen.every((shown) => shown === c), "the view is never cleared on the way, which would remount it");
  assert.equal(opens.length, opened, "and nothing is read again");
  store.dispose();
});

test("moving to another conversation never passes through having none", async () => {
  const { store, closed } = harness();
  await store.load();
  const first = store.getSnapshot().conversation!;
  const seen: unknown[] = [];
  const stop = store.subscribe(() => seen.push(store.getSnapshot().conversation));
  await store.open("another");
  stop();
  assert.ok(seen.length > 0, "the move was published");
  assert.ok(
    seen.every((shown) => shown !== undefined),
    "the view is never cleared on the way: that renders the screen for no conversation, for a frame",
  );
  assert.notEqual(store.getSnapshot().conversation, first);
  assert.ok(closed.includes(first.subscription), "and the one left is still closed, as soon as it is not the open one");
  store.dispose();
});

test("where a conversation was left above the latest line is remembered until it or its agent is gone", async () => {
  const { store } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  assert.equal(store.scrollOf(c.agentId, c.session), undefined, "a conversation opens at its latest line");
  store.rememberScroll(c.agentId, c.session, { turn: "e-12", row: 1, offset: -30 });
  store.rememberScroll("b", "b-1", { turn: "e-3", row: 0, offset: 0 });
  assert.deepEqual(store.scrollOf(c.agentId, c.session), { turn: "e-12", row: 1, offset: -30 });
  assert.deepEqual(store.scrollOf("b", "b-1"), { turn: "e-3", row: 0, offset: 0 }, "each conversation has its own place");
  store.rememberScroll(c.agentId, c.session, undefined);
  assert.equal(store.scrollOf(c.agentId, c.session), undefined, "scrolling back to the latest line forgets it");

  store.rememberScroll(c.agentId, c.session, { turn: "e-12", row: 1, offset: -30 });
  await store.deleteSession(c.agentId, c.session);
  assert.equal(store.scrollOf(c.agentId, c.session), undefined, "a deleted conversation leaves no place behind");
  store.rememberScroll("a", "later", { row: 1, offset: 0 });
  await store.removeAgent();
  assert.equal(store.scrollOf("a", "later"), undefined, "a removed agent leaves none behind");
  assert.deepEqual(store.scrollOf("b", "b-1"), { turn: "e-3", row: 0, offset: 0 }, "another agent's places are not touched");
  store.dispose();
});

test("a model change leaves the open conversation as it is and reads its model and levels again", async () => {
  const { api, store, opens, closed } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const items = c.items;
  const opened = opens.length;
  api.readState = async () => ({
    status: "idle",
    pending: { steering: [], followUp: [] },
    model: "provider/other",
    thinkingLevel: "low",
    availableThinkingLevels: ["low", "high"],
  });
  // The agent's runtime now answers with the new default, as main's does after the change.
  api.openAgent = async () => ({ ...ready, model: "provider/other" });
  await store.pickModel("provider/other");
  assert.equal(store.getSnapshot().conversation, c, "the same conversation, not a reopened one");
  assert.equal(c.items, items, "its transcript is not reloaded, so nothing flickers and the scroll stays");
  assert.equal(opens.length, opened, "main moved the subscription; the window does not open another");
  assert.equal(closed.length, 0, "and does not close the one it has");
  assert.equal(store.getSnapshot().model, "provider/other");
  assert.equal(c.state?.model, "provider/other", "the chip and the effort track follow the new model");
  assert.deepEqual(c.state?.availableThinkingLevels, ["low", "high"]);
  store.dispose();
});

test("a thinking level goes to the open conversation, and a refusal reaches it verbatim", async () => {
  const { api, store } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent: unknown[][] = [];
  api.setThinking = async (...args) => {
    sent.push(args);
    return { ok: true };
  };
  await store.setThinking("high");
  assert.deepEqual(sent, [["a", c.session, "high"]], "the level is set on the conversation the person is looking at");
  api.setThinking = async () => ({
    ok: false,
    error: { code: "invalid", message: 'thinking level "xhigh" is not supported', retryable: false },
  });
  await store.setThinking("xhigh");
  const noted = c.items.filter((item) => item.kind === "note" && item.text === 'thinking level "xhigh" is not supported');
  assert.equal(noted.length, 1, "a refusal is shown, not swallowed");
  store.dispose();
});

test("a conversation not begun yet offers the levels the runtime reports for its first turn", async () => {
  const { api, store } = harness();
  const levels = { model: "provider/model", thinkingLevel: "medium", availableThinkingLevels: ["off", "medium", "high"] };
  api.openSession = async () => ({ ...empty(), state: { ...empty().state, ...levels } });
  const set: string[] = [];
  api.setThinking = async (_id, _session, level) => {
    set.push(level);
    return { ok: true };
  };
  await store.load();
  assert.deepEqual(store.getSnapshot().conversation?.state?.availableThinkingLevels, ["off", "medium", "high"]);
  assert.equal(store.getSnapshot().pane, "start", "still the new-conversation page");
  // The runtime now keeps a record of it, with no message yet.
  const c = store.getSnapshot().conversation!;
  api.openAgent = async () =>
    ({ ok: true, model: "provider/model", sessions: [{ session: c.session, createdAt: 1, updatedAt: 1, messageCount: 0 }] }) as never;
  await store.setThinking("high");
  assert.deepEqual(set, ["high"], "set before the first message, on the conversation itself");
  await store.newConversation();
  assert.ok(
    store.getSnapshot().sessions["a"]?.some((s) => s.session === c.session),
    "the list was read again, so the conversation stays listed once it is left",
  );
  store.dispose();
});

test("settings read after a model change land only on the conversation they were read for, and silence keeps the model", async () => {
  const { api, store, closed } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const late = deferred<Awaited<ReturnType<typeof api.readState>>>();
  api.readState = () => late.promise;
  const picking = store.pickModel("provider/model");
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Walking away from an idle conversation releases it; the read is still out.
  await store.newConversation();
  assert.ok(closed.includes(c.subscription), "the conversation was released while its read was in flight");
  late.resolve({
    status: "idle",
    pending: { steering: [], followUp: [] },
    thinkingLevel: "high",
    availableThinkingLevels: ["off", "high"],
  });
  await picking;
  assert.equal(c.state?.availableThinkingLevels, undefined, "a late answer does not land on a released conversation");

  // A read that answers without the three fields does not erase the model an event reported.
  const kept = harness();
  await kept.store.load();
  const open = kept.store.getSnapshot().conversation!;
  kept.emit(open, "state_changed", { model: "provider/other" });
  kept.api.readState = async () => ({ status: "idle", pending: { steering: [], followUp: [] } });
  await kept.store.pickModel("provider/model");
  assert.equal(kept.store.getSnapshot().conversation?.state?.model, "provider/other");
  store.dispose();
  kept.store.dispose();
});

test("reveal opens the agent it is given, else the open one, and the registry when there is none", async () => {
  const { api, store } = harness();
  const revealed: string[] = [];
  api.revealAgent = async (id) => void revealed.push(`agent:${id}`);
  api.revealRegistry = async () => void revealed.push("registry");
  await store.load();
  await store.reveal("b");
  await store.reveal();
  assert.deepEqual(revealed, ["agent:b", "agent:a"], "a row's menu names its own agent; the header's default is the open one");
  store.dispose();

  const empty = harness();
  empty.api.listAgents = async () => [];
  empty.api.revealAgent = async (id) => void revealed.push(`agent:${id}`);
  empty.api.revealRegistry = async () => void revealed.push("registry");
  await empty.store.load();
  revealed.length = 0;
  await empty.store.reveal();
  assert.deepEqual(revealed, ["registry"], "with no agent, the list itself is what there is to show");
  empty.store.dispose();
});

test("the picker rereads models on every open, and a stale answer never lands", async () => {
  const { api, store } = harness();
  let listed = 0;
  const askedFor: string[] = [];
  api.listModels = async (agentId) => {
    listed++;
    askedFor.push(agentId);
    return described(["provider/model"]);
  };
  await store.load();

  await store.loadModels();
  assert.deepEqual(store.getSnapshot().models, described(["provider/model"]));
  assert.deepEqual(askedFor, [store.getSnapshot().agentId], "the list is the open agent's own (its models.json)");
  await store.loadModels();
  assert.equal(listed, 2, "a login while duang runs must show up without a restart");

  api.listModels = async () => {
    throw new Error("corrupt auth file");
  };
  await store.loadModels();
  assert.equal(store.getSnapshot().modelsError, "corrupt auth file", "the reader's own sentence, unwrapped");
  assert.equal(store.getSnapshot().models, undefined, "a failed read must not show stale models as current");

  // A slow first read must not overwrite what the reopened picker already showed.
  const slow = deferred<Models>();
  api.listModels = () => slow.promise;
  const pending = store.loadModels();
  api.listModels = async () => (described(["provider/current"]));
  await store.loadModels();
  slow.resolve(described(["provider/stale"]));
  await pending;
  assert.deepEqual(store.getSnapshot().models?.map((model) => model.spec), ["provider/current"]);
  store.dispose();
});

test("refreshing models reports what arrived, keeps the list on failure, and answers only the agent and picker that asked", async () => {
  const { api, store } = harness();
  const asked: string[] = [];
  api.listModels = async () => (described(["provider/old"]));
  api.refreshModels = async (agentId) => {
    asked.push(agentId);
    return described(["provider/old", "provider/new", "provider/newer"]);
  };
  await store.load();
  await store.loadModels();

  await store.refreshModels();
  assert.deepEqual(asked, [store.getSnapshot().agentId], "the open agent's own catalog is what is refreshed");
  assert.deepEqual(store.getSnapshot().models?.map((model) => model.spec), ["provider/old", "provider/new", "provider/newer"]);
  assert.deepEqual(store.getSnapshot().modelsRefresh, { status: "done", added: 2 }, "the person is told what changed");

  api.refreshModels = async () => (described(["provider/old", "provider/new", "provider/newer"]));
  await store.refreshModels();
  assert.deepEqual(store.getSnapshot().modelsRefresh, { status: "done", added: 0 }, "nothing new is an answer too");

  // A failed refresh leaves the models that are there runnable, and says why in FastAgent's own words.
  api.refreshModels = async () => {
    throw new Error("Error invoking remote method 'models:refresh': Error: could not refresh the model catalog: anthropic: 401");
  };
  await store.refreshModels();
  assert.deepEqual(store.getSnapshot().modelsRefresh, {
    status: "failed",
    error: "could not refresh the model catalog: anthropic: 401",
  });
  assert.equal(store.getSnapshot().models?.map((model) => model.spec).length, 3, "a failed refresh does not empty or stale the list");

  // One at a time: a second press while one runs is not a second request.
  const slow = deferred<Models>();
  let calls = 0;
  api.refreshModels = () => (calls++, slow.promise);
  const first = store.refreshModels();
  void store.refreshModels(); // not awaited: without the guard it would wait on `slow` forever
  assert.equal(calls, 1, "pressing again while the refresh runs does not start another");
  assert.deepEqual(store.getSnapshot().modelsRefresh, { status: "running" });
  slow.resolve(described(["provider/old"]));
  await first;

  // The picker reopened meanwhile reads the list itself; the older answer must not overwrite it.
  const late = deferred<Models>();
  api.refreshModels = () => late.promise;
  const pending = store.refreshModels();
  api.listModels = async () => (described(["provider/current"]));
  await store.loadModels();
  late.resolve(described(["provider/stale"]));
  await pending;
  assert.deepEqual(store.getSnapshot().models?.map((model) => model.spec), ["provider/current"]);
  assert.equal(store.getSnapshot().modelsRefresh, undefined, "and a superseded refresh leaves no 'running' behind");

  // An answer for an agent the person has left belongs to that agent, not the one now open.
  const away = deferred<Models>();
  api.refreshModels = () => away.promise;
  const gone = store.refreshModels();
  await store.selectAgent("b");
  away.resolve(described(["provider/from-a"]));
  await gone;
  assert.deepEqual(store.getSnapshot().models?.map((model) => model.spec), ["provider/current"], "agent A's list is not agent B's");
  store.dispose();
});

test("command names load once per agent, retry after a failure, and never cross agents", async () => {
  const { api, store } = harness();
  const commandCalls: string[] = [];
  api.listCommands = async (agentId) => {
    commandCalls.push(agentId);
    return [{ name: "plan", description: "", source: "definition" }];
  };
  await store.load();

  await store.loadCommands();
  await store.loadCommands();
  assert.deepEqual(commandCalls, ["a"], "the names are fetched once for this agent");
  assert.equal(store.getSnapshot().commands[0]?.name, "plan");

  await store.selectAgent("b");
  assert.deepEqual(store.getSnapshot().commands, [], "another agent has its own definition");
  api.listCommands = async (agentId) => {
    commandCalls.push(agentId);
    throw new Error("definition unreadable");
  };
  await store.loadCommands();
  assert.equal(store.getSnapshot().commandsError, "definition unreadable");
  api.listCommands = async (agentId) => {
    commandCalls.push(agentId);
    return [{ name: "review", description: "", source: "definition" }];
  };
  await store.loadCommands();
  assert.equal(store.getSnapshot().commands[0]?.name, "review", "a failed load must not lock the agent out");
  assert.deepEqual(commandCalls, ["a", "b", "b"]);

  // Switching away mid-flight: the late answer belongs to an agent nobody is looking at.
  const slow = deferred<{ name: string; description: string; source: string }[]>();
  await store.selectAgent("a");
  api.listCommands = () => slow.promise as ReturnType<DuangApi["listCommands"]>;
  const pending = store.loadCommands();
  await store.selectAgent("b");
  slow.resolve([{ name: "from-a", description: "", source: "definition" }]);
  await pending;
  assert.deepEqual(store.getSnapshot().commands, [], "an answer for the agent we left must not be shown");
  store.dispose();
});

test("the sidebar acts on the agent it names: deleting, listing and opening another agent's conversation", async () => {
  const { api, store, opens } = harness();
  const deletes: string[][] = [];
  api.deleteSession = async (agentId, session) => {
    deletes.push([agentId, session]);
    return { ok: true };
  };
  api.openAgent = async (id) => (id === "b" ? listed("b-1") : ready);
  await store.load();
  assert.equal(store.getSnapshot().agentId, "a");

  // B's row reads its conversations without opening it.
  await store.listSessions("b");
  assert.deepEqual(
    store.getSnapshot().sessions["b"]?.map((s) => s.session),
    ["b-1"],
  );
  assert.equal(store.getSnapshot().agentId, "a", "listing is not opening");

  // Deleting from B's row must reach B, not whichever agent happens to be open, and the row has to
  // leave B's list even though B is not the agent on screen.
  await store.deleteSession("b", "b-1");
  assert.deepEqual(deletes, [["b", "b-1"]]);
  assert.deepEqual(store.getSnapshot().sessions["b"], [], "the deleted conversation leaves the list");
  assert.equal(store.getSnapshot().conversation?.agentId, "a", "A's conversation is untouched");

  // Clicking a conversation of another agent is one navigation that lands on that conversation.
  api.openAgent = async (id) => (id === "b" ? listed("b-2") : ready);
  await store.selectAgent("b", "b-2");
  assert.equal(store.getSnapshot().conversation?.agentId, "b");
  assert.equal(store.getSnapshot().conversation?.session, "b-2");
  assert.ok(opens.includes("b-2"));
  store.dispose();
});

test("an agent whose list cannot be read says why, on its own row", async () => {
  const { api, store } = harness();
  await store.load();
  const openConversation = store.getSnapshot().conversation!;
  api.openAgent = async (id) =>
    id === "b" ? { ok: false, code: "broken", message: "runtime would not start" } : ready;

  await store.listSessions("b");
  assert.equal(store.getSnapshot().sessionsError["b"], "runtime would not start");
  assert.equal(store.getSnapshot().states.b, "broken", "another agent's row says its setup in words");
  // The open agent's state drives the main panel: a background re-read must not declare the
  // window broken with nothing to show for it.
  api.openAgent = async () => ({ ok: false, code: "broken", message: "runtime would not start" });
  await store.listSessions("a");
  assert.equal(store.getSnapshot().states.a, "ready");
  assert.equal(
    openConversation.items.filter((item) => item.kind === "note").length,
    0,
    "another agent's failure never lands in the transcript being read",
  );

  // Asking again after the cause is fixed clears it, rather than caching the first answer forever.
  api.openAgent = async () => listed("b-1");
  await store.listSessions("b");
  assert.equal(store.getSnapshot().sessionsError["b"], undefined);
  assert.equal(store.getSnapshot().states.b, "ready");
  assert.deepEqual(
    store.getSnapshot().sessions["b"]?.map((s) => s.session),
    ["b-1"],
  );
  store.dispose();
});

test("a refusal and a failure are different answers in the transcript", async () => {
  const { api, store } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  api.setModel = async () => ({
    ok: false,
    error: { code: "model_unavailable", message: "gpt-9 is not in the configured credential file", retryable: false },
  });
  api.abort = async () => ({ ok: false, error: { code: "failed", message: "the runtime crashed", retryable: true } });

  // Nothing ran, so this is refused: the model is unchanged and the person's text is still theirs.
  await store.pickModel("provider/gpt-9");
  // A request that did run and broke is a failure.
  await store.abort();

  assert.deepEqual(
    c.items.filter((item) => item.kind === "note").map((item) => [item.tone, item.text]),
    [
      ["warning", "gpt-9 is not in the configured credential file"],
      ["error", "the runtime crashed"],
    ],
  );
  store.dispose();
});

test("what finished while you were elsewhere is marked, and opening it spends the mark", async () => {
  const { store, emit } = harness();
  await store.load();
  const background = store.getSnapshot().conversation!;
  emit(background, "run_started");
  await store.newConversation();
  assert.notEqual(store.getSnapshot().conversation, background, "the run is now in the background");

  emit(background, "run_settled", { status: "completed" });
  assert.deepEqual(store.getSnapshot().unseen["a"], { [background.session]: "done" }, "an outcome you missed is kept");

  await store.open(background.session);
  assert.deepEqual(store.getSnapshot().unseen["a"] ?? {}, {}, "looking at it is what spends the mark");

  // A failure you missed is kept as a failure; one you were watching needs no mark at all.
  const other = store.getSnapshot().conversation!;
  emit(other, "run_started");
  emit(other, "run_settled", { status: "failed", error: { message: "boom" } });
  assert.deepEqual(store.getSnapshot().unseen["a"] ?? {}, {}, "a run you watched settle is not news");

  // A conversation nobody is watching is only kept alive while its turn is in flight, so the run
  // has to start before walking away — which is also the only way to miss its outcome.
  emit(other, "run_started");
  await store.newConversation();
  emit(other, "run_settled", { status: "failed", error: { message: "boom" } });
  assert.deepEqual(store.getSnapshot().unseen["a"], { [other.session]: "failed" });

  // Stopping a run yourself is a decision, not something to come back to.
  const third = store.getSnapshot().conversation!;
  emit(third, "run_started");
  await store.open(other.session);
  emit(third, "run_settled", { status: "aborted" });
  assert.equal(store.getSnapshot().unseen["a"]?.[third.session], undefined, "a stop is not unseen news");
  store.dispose();
});

/** The runtime reporting a user message entering the conversation, as FastAgent's `user_message` does. */
let entries = 0;
const entered = (emit: ReturnType<typeof harness>["emit"], c: Parameters<ReturnType<typeof harness>["emit"]>[0], text: string, entryId = `e${++entries}`) =>
  emit(c, "user_message", { entryId, text });
const said = (c: { items: { kind: string; text?: string; steered?: boolean }[] }) =>
  c.items.flatMap((item) =>
    item.kind === "user" ? [`${item.steered ? "joined" : "you"}:${item.text}`] : item.kind === "assistant" || item.kind === "note" ? [item.text!] : [],
  );

test("a message is placed where the runtime says it entered, and joins only a run that already had one", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  type Sent = Awaited<ReturnType<DuangApi["send"]>>;
  // A message that opens a run returns when the run is over; a steer returns once it is queued.
  const opening = deferred<Sent>();
  api.send = () => opening.promise;
  store.setDraft("start");
  const sending = store.send();
  api.send = async () => ({ ok: true });
  assert.deepEqual(said(c), [], "sent, not yet in the conversation");
  assert.deepEqual(c.waiting.map((item) => [item.text, item.opens]), [["start", true]], "from idle, it opens the run");
  emit(c, "run_started");
  entered(emit, c, "start");
  emit(c, "message_delta", { channel: "text", delta: "on the old plan" });
  emit(c, "message_finished");

  // A steer waits below the output: the model keeps working without it until the next turn boundary.
  store.setDraft("wait");
  await store.send();
  assert.equal(c.waiting[0]?.opens, false, "a run that has its message is joined");
  emit(c, "queue_changed", { steering: ["wait"], followUp: [] });
  assert.deepEqual(queueView(c.waiting, c.state!.pending.steering).map(({ item, listed }) => [item.text, listed]), [["wait", true]]);
  emit(c, "message_delta", { channel: "text", delta: "still going" });
  emit(c, "message_finished");
  emit(c, "queue_changed", { steering: [], followUp: [] });
  entered(emit, c, "wait");
  emit(c, "message_delta", { channel: "text", delta: "stopping" });
  assert.deepEqual(said(c), ["you:start", "on the old plan", "still going", "joined:wait", "stopping"]);
  assert.equal(c.waiting.length, 0);

  // Walking away and back during the run keeps a waiting message on screen.
  store.setDraft("later");
  await store.send();
  await store.newConversation();
  await store.open(c.session);
  assert.equal(store.getSnapshot().conversation, c, "a running conversation is reused, not reloaded");
  assert.deepEqual(c.waiting.map((item) => item.text), ["later"]);
  entered(emit, c, "later");
  emit(c, "run_settled", { status: "completed" });
  opening.resolve({ ok: true });
  await sending;

  // Compaction is not a run: what is sent during it opens the next run.
  emit(c, "state_changed", { status: "compacting" });
  const next = deferred<Sent>();
  api.send = () => next.promise;
  store.setDraft("after compaction");
  const compacting = store.send();
  assert.equal(c.waiting[0]?.opens, false, "not the compaction's message: it waits below its working mark");
  emit(c, "run_started");
  entered(emit, c, "after compaction");
  assert.equal(said(c).at(-1), "you:after compaction");
  emit(c, "run_settled", { status: "completed" });
  next.resolve({ ok: true });
  await compacting;
  assert.equal(said(c).some((line) => line.startsWith("ran ")), false, "a message that entered did not just run");
  store.dispose();
});

test("a message still queued when the run ends returns to the draft; one that missed the run opens the next", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  store.setDraft("start");
  await store.send();
  emit(c, "run_started");
  entered(emit, c, "start");

  store.setDraft("too late");
  await store.send();
  emit(c, "queue_changed", { steering: ["too late"], followUp: [] });
  emit(c, "run_settled", { status: "aborted" });
  assert.equal(said(c).includes("joined:too late"), false, "never shown as delivered");
  assert.equal(c.waiting.length, 0);
  assert.equal(c.draft, "too late");

  // Sent as the next run ended, before the runtime queued it: main starts a turn with it, and its
  // send returns only when that turn is over.
  c.draft = "";
  emit(c, "run_started");
  entered(emit, c, "again");
  const raced = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => raced.promise;
  store.setDraft("raced");
  const sending = store.send();
  emit(c, "run_settled", { status: "completed" });
  assert.deepEqual(c.waiting.map((item) => item.text), ["raced"], "it waits for the run it opens");
  emit(c, "run_started");
  entered(emit, c, "raced");
  emit(c, "message_delta", { channel: "text", delta: "answer to raced" });
  assert.deepEqual(said(c).slice(-2), ["you:raced", "answer to raced"]);
  raced.resolve({ ok: true });
  await sending;
  store.dispose();
});

test("a refused first message returns to the draft, and one sent after it opens its own run above its answer", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const first = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => first.promise;
  store.setDraft("A");
  const sending = store.send();
  const second = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => second.promise;
  store.setDraft("B");
  const sendingB = store.send();
  first.resolve({ ok: false, error: { code: "refused", message: "no", retryable: false } });
  await sending;
  assert.equal(c.draft, "A");
  emit(c, "run_started");
  entered(emit, c, "B");
  emit(c, "message_delta", { channel: "text", delta: "answer to B" });
  assert.deepEqual(said(c), ["no", "you:B", "answer to B"]);
  emit(c, "run_settled", { status: "completed" });
  second.resolve({ ok: true });
  await sendingB;
  store.dispose();
});

test("the runtime's queue shows messages from elsewhere; a backfilled entry is not added twice; a command that sends nothing says it ran", async () => {
  const { api, store, emit } = harness();
  const history: SessionEntry[] = [{ id: "u1", timestamp: 1, kind: "user", data: { text: "opening" } }];
  api.openSession = async () => ({
    state: { status: "running" as const, activeRunId: "run", pending: { steering: ["before reload"], followUp: [] } },
    entries: { entries: history, leafEntryId: "u1" },
  });
  await store.load();
  const c = store.getSnapshot().conversation!;
  // Queued before this window opened: not ours, still shown.
  assert.deepEqual(queueView(c.waiting, c.state!.pending.steering).map(({ item }) => item.text), ["before reload"]);
  emit(c, "queue_changed", { steering: [], followUp: [] });
  entered(emit, c, "before reload");
  assert.deepEqual(said(c), ["you:opening", "joined:before reload"], "the run already had its opening message");
  // An event that overlapped the history read names an entry already on screen.
  entered(emit, c, "opening", "u1");
  assert.deepEqual(said(c), ["you:opening", "joined:before reload"]);

  // A slash command enters expanded; it is still the message typed here.
  store.setDraft("/skill:demo");
  await store.send();
  entered(emit, c, "Say demo.");
  assert.equal(said(c).at(-1), "joined:/skill:demo");
  emit(c, "run_settled", { status: "completed" });

  // An extension command that did its work without sending anything into the conversation.
  const done = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => done.promise;
  store.setDraft("/go X");
  const sending = store.send();
  emit(c, "run_started");
  emit(c, "run_settled", { status: "completed" });
  done.resolve({ ok: true });
  await sending;
  assert.equal(said(c).at(-1), "ran /go X");
  assert.equal(c.waiting.length, 0);
  assert.equal(c.draft, "", "it ran, so it is not the person's to send again");

  // The same, when the call returns before the run's end has been heard.
  const early = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => early.promise;
  store.setDraft("/go Y");
  const sendingY = store.send();
  emit(c, "run_started");
  early.resolve({ ok: true });
  await sendingY;
  assert.deepEqual(c.waiting.map((item) => item.text), ["/go Y"], "the run may still place it");
  emit(c, "run_settled", { status: "completed" });
  assert.equal(said(c).at(-1), "ran /go Y");
  store.dispose();
});

test("a steer queued before a reload returns to the draft when the run drops it", async () => {
  const { api, store, emit } = harness();
  api.openSession = async () => ({
    state: { status: "running" as const, activeRunId: "run", pending: { steering: ["typed before reload"], followUp: [] } },
    entries: { entries: [] },
  });
  await store.load();
  const c = store.getSnapshot().conversation!;
  // Stop: pi's abort does not clear the queue, so the settling run still lists it.
  emit(c, "run_settled", { status: "aborted" });
  assert.equal(c.draft, "typed before reload", "the runtime's queue was the only place these words existed");
  store.dispose();
});

test("a steer that enters as pi's next attempt starts ends the retry's wait, and a later one is one line", async () => {
  const { store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const retries = () => c.items.filter((item) => item.kind === "note" && item.retry).map((item) => (item as { text: string }).text);
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u1", text: "fix it" });
  emit(c, "retry_scheduled", { attempt: 1, maxAttempts: 3, error: "OpenAI API error (529): overloaded" });
  // Typed during the wait, the steer enters when the next attempt starts.
  emit(c, "user_message", { entryId: "u2", text: "and the tests" });
  assert.deepEqual(retries(), ["retried once: the provider had a problem"], "the wait is over once the steer enters");
  emit(c, "message_delta", { channel: "text", delta: "On it" });
  assert.deepEqual(retries(), ["retried once: the provider had a problem"]);
  // That attempt fails too: one line waits again, after the steer; the earlier one stays said in the past.
  emit(c, "retry_scheduled", { attempt: 2, maxAttempts: 3, error: "OpenAI API error (529): overloaded" });
  assert.deepEqual(retries(), ["retried once: the provider had a problem", "retrying 2/3: the provider had a problem"]);
  emit(c, "run_settled", { status: "completed" });
  assert.deepEqual(retries(), ["retried once: the provider had a problem"], "a wait the run ended in goes with it");
  store.dispose();
});

test("a message sent to start a turn is what the row quotes at once, not the failure before it", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  emit(c, "run_started");
  emit(c, "run_settled", { status: "failed", error: { message: "OpenAI API error (529): overloaded", retryable: true } });
  assert.equal(store.getSnapshot().previews["a"]?.text, "The provider had a problem");
  const sent = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => sent.promise;
  store.setDraft("try again please");
  const sending = store.send();
  assert.equal(store.getSnapshot().previews["a"]?.text, "You: try again please", "before the runtime reports it");
  sent.resolve({ ok: true });
  await sending;
  store.dispose();
});

test("a send that returns after the stream ended does not claim its message ran without entering", async () => {
  const { api, store, emit, end } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => sent.promise;
  store.setDraft("hello");
  const sending = store.send();
  emit(c, "run_started");
  end(c, "stream disconnected", "failed");
  sent.resolve({ ok: true });
  await sending;
  assert.equal(
    c.items.some((item) => item.kind === "note" && item.text.startsWith("ran ")),
    false,
    "whether it entered is unknown here; Retry reads the history",
  );
  store.dispose();
});

test("the open agent's list keeps the newest answer, and a failed re-read lands on its row", async () => {
  const { api, store, emit } = harness();
  api.openAgent = async () => listed("s1");
  await store.load();
  const c = store.getSnapshot().conversation!;
  const older = deferred<OpenResult>();
  const newer = deferred<OpenResult>();
  const answers = [older.promise, newer.promise];
  api.openAgent = () => answers.shift()!;
  // A rename re-reads the list; the run settling while that read is out re-reads it again.
  const renamed = store.listSessions("a");
  emit(c, "run_started");
  emit(c, "run_settled", { status: "completed" });
  newer.resolve({
    ok: true,
    model: "provider/model",
    sessions: [{ session: "s1", name: "Newest", updatedAt: 9, createdAt: 0, messageCount: 4 }],
  } as never);
  await new Promise((resolve) => setImmediate(resolve));
  older.resolve(listed("s1"));
  await renamed;
  assert.equal(store.getSnapshot().sessions["a"]?.[0]?.name, "Newest", "the slower, older answer does not win");

  api.openAgent = async () => ({ ok: false, code: "broken", message: "runtime gone" });
  emit(c, "run_started");
  emit(c, "run_settled", { status: "completed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().sessionsError["a"], "runtime gone");
  assert.ok(!c.items.some((item) => item.kind === "note" && item.text === "runtime gone"), "said on the row, once");
  store.dispose();
});

test("settings are read fresh each time, and only the newest change and check land", async () => {
  const { api, store } = harness();
  type Checked = Awaited<ReturnType<DuangApi["testNetwork"]>>;
  type Routed = Awaited<ReturnType<DuangApi["setNetwork"]>>;
  api.getSettings = async () => {
    throw new Error("settings.json: Unexpected token");
  };
  assert.equal(await store.loadSettings(), undefined);
  assert.equal(store.getSnapshot().settingsError, "settings.json: Unexpected token");
  assert.equal(store.getSnapshot().settings, undefined, "an unreadable file is not shown as the defaults");

  const staleCheck = deferred<Checked>();
  const freshCheck = deferred<Checked>();
  const checks = [staleCheck.promise, freshCheck.promise];
  api.testNetwork = () => checks.shift()!;
  api.getSettings = async () => ({ network: { mode: "automatic" }, avatar: "gaze" });
  assert.deepEqual((await store.loadSettings())?.network, { mode: "automatic" });
  assert.equal(store.getSnapshot().settingsError, undefined);
  assert.deepEqual(store.getSnapshot().connection, { checking: true });

  // Two quick choices: the first answer arrives last. It must not win, and it reports nothing.
  const slow = deferred<Routed>();
  const fast = deferred<Routed>();
  const routes = [slow.promise, fast.promise];
  api.setNetwork = () => routes.shift()!;
  const manual = store.setNetwork({ mode: "manual", url: "http://127.0.0.1:7890" });
  const off = store.setNetwork({ mode: "off" });
  fast.resolve({ source: "off" });
  assert.equal(await off, undefined);
  slow.reject(new Error("proxy refused"));
  assert.equal(await manual, undefined, "a superseded choice's failure is not the page's problem");
  assert.deepEqual(store.getSnapshot().settings, { network: { mode: "off" }, route: { source: "off" } });

  // The check started for the old route answers after the one for the new route.
  freshCheck.resolve({ status: 200, ms: 12, route: { source: "off" } });
  await new Promise((resolve) => setImmediate(resolve));
  staleCheck.resolve({ status: 407, ms: 3, route: { source: "system" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().connection, { status: 200, ms: 12, route: { source: "off" } });

  // A choice that fails on its own says why, to the form that made it.
  api.setNetwork = async () => {
    throw new Error("Not a URL: nope");
  };
  assert.equal(await store.setNetwork({ mode: "manual", url: "nope" }), "Not a URL: nope");
  store.dispose();
});

test("a renamed conversation takes the label the runtime reports, and a refusal stays in its own transcript", async () => {
  const { api, store } = harness();
  const renames: string[][] = [];
  api.renameSession = async (agentId, session, name) => {
    renames.push([agentId, session, name]);
    return { ok: true };
  };
  api.openAgent = async () => listed("s1");
  await store.load();
  const c = store.getSnapshot().conversation!;

  api.openAgent = async () =>
    ({
      ok: true,
      model: "provider/model",
      sessions: [{ session: "s1", name: "The i18n check", updatedAt: 6, createdAt: 0, messageCount: 2 }],
    }) as never;
  await store.renameSession("a", "s1", "The i18n check");
  assert.deepEqual(renames, [["a", "s1", "The i18n check"]]);
  assert.equal(store.getSnapshot().sessions["a"]?.[0]?.name, "The i18n check", "the list is re-read, not patched");

  // A refused rename is a refusal: nothing ran, and it belongs to that conversation's transcript.
  api.renameSession = async () => ({ ok: false, error: { code: "busy", message: "session is busy", retryable: true } });
  await store.renameSession("a", "s1", "Another name");
  assert.deepEqual(
    c.items.filter((item) => item.kind === "note").map((item) => [item.tone, item.text]),
    [["warning", "session is busy"]],
  );
  store.dispose();
});

test("a rename that cannot be read back, and one refused on a conversation nobody opened, both say so", async () => {
  const { api, store } = harness();
  api.openAgent = async () => listed("s1");
  await store.load();

  // The name is written, and re-reading the list fails: the row would otherwise keep the old label
  // with nothing said about it.
  api.openAgent = async () => ({ ok: false, code: "broken", message: "runtime would not restart" });
  await store.renameSession("a", "s1", "Named");
  assert.equal(store.getSnapshot().sessionsError["a"], "runtime would not restart");

  // A conversation of another agent, never opened here: there is no transcript to put a refusal in, so it
  // is said by what it was, not as that agent's list failing to read nor with someone else's Retry.
  api.renameSession = async () => ({ ok: false, error: { code: "busy", message: "session is busy", retryable: true } });
  await store.renameSession("b", "never-opened", "Named");
  assert.deepEqual(store.getSnapshot().failure, { title: "The conversation was not renamed", reason: "session is busy" });
  assert.equal(store.getSnapshot().sessionsError["b"], undefined, "the list was read; this is not that");
  assert.equal(store.getSnapshot().error, undefined, "and not into the banner with someone else's Retry");
  store.dispose();
});

test("plan usage is kept per provider, and a failed read replaces the numbers with its reason", async () => {
  const { api, store } = harness();
  const data = { provider: "anthropic", windows: [{ label: "5h", percent: 4, windowSeconds: 18_000 }], fetchedAt: 1 };
  api.providerUsage = async () => data;
  await store.loadUsage("anthropic");
  assert.deepEqual(store.getSnapshot().usage.anthropic, { data });

  api.providerUsage = async () => {
    throw new Error("Error invoking remote method 'usage:get': Error: api.anthropic.com answered 429: rate limited");
  };
  await store.loadUsage("anthropic");
  assert.deepEqual(
    store.getSnapshot().usage.anthropic,
    { error: "api.anthropic.com answered 429: rate limited" },
    "a stale percentage must not stay on screen as current",
  );

  api.providerUsage = async () => data;
  await store.loadUsage("anthropic");
  await store.disconnect("anthropic");
  assert.equal(store.getSnapshot().usage.anthropic, undefined, "a disconnected plan's numbers go with it");
  store.dispose();
});

test("a roster row quotes the newest output of the conversation it speaks for, live while it streams", async () => {
  const { api, store, emit } = harness();
  const reads: string[][] = [];
  api.openAgent = async (id) => (id === "b" ? listed("b-1") : ready);
  api.readSession = async (id, session) => {
    reads.push([id, session]);
    return { entries: [{ id: "e1", timestamp: 7, kind: "assistant", data: { text: "B finished the report." } }] };
  };
  await store.load();
  await new Promise((resolve) => setImmediate(resolve));
  // B is not open, so its row reads the history of the conversation a click would show, once.
  assert.deepEqual(reads, [["b", "b-1"]]);
  assert.deepEqual(store.getSnapshot().previews["b"], { session: "b-1", text: "B finished the report.", at: 7 });
  await store.listSessions("b");
  assert.equal(reads.length, 1, "a conversation that has not moved on is not read again");

  // The open agent's row follows its conversation as it streams, with no read at all.
  const a = store.getSnapshot().conversation!;
  emit(a, "run_started");
  emit(a, "message_delta", { channel: "text", delta: "Working on" });
  assert.equal(store.getSnapshot().previews["a"]?.text, "Working on");
  emit(a, "message_delta", { channel: "text", delta: " it" });
  assert.equal(store.getSnapshot().previews["a"]?.text, "Working on it");
  assert.ok(!reads.some(([id]) => id === "a"));

  // A failed read says so on the row instead of quoting something older.
  api.openAgent = async (id) => (id === "b" ? listed("b-2") : ready);
  api.readSession = async () => {
    throw new Error("history unreadable");
  };
  await store.listSessions("b");
  assert.deepEqual(store.getSnapshot().previews["b"], { session: "b-2", error: "history unreadable" });

  // A deleted conversation is not quoted as if it were still there.
  await store.deleteSession("b", "b-2");
  assert.equal(store.getSnapshot().previews["b"], undefined);
  store.dispose();
});

test("a slow history read cannot replace a newer one", async () => {
  const { api, store } = harness();
  const at = (updatedAt: number) =>
    ({ ...ready, sessions: [{ session: "b-1", updatedAt, createdAt: 0, messageCount: 2 }] }) as OpenResult;
  const reply = (text: string) => ({ entries: [{ id: text, timestamp: 1, kind: "assistant", data: { text } }] });
  const slow = deferred<ReturnType<typeof reply>>();
  api.openAgent = async (id) => (id === "b" ? at(1) : ready);
  api.readSession = () => slow.promise;
  await store.load();
  api.openAgent = async (id) => (id === "b" ? at(2) : ready);
  api.readSession = async () => reply("newer");
  await store.listSessions("b");
  slow.resolve(reply("older"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().previews["b"]?.text, "newer");
  store.dispose();
});

test("a sign-in shows what its flow asks, sends the answer once, and ends by its outcome", async () => {
  const { api, store, step } = harness();
  await store.load();
  const anthropic: ProviderRow = {
    id: "anthropic",
    name: "Anthropic",
    ways: [
      { method: "oauth", label: "Anthropic (Claude Pro/Max)", subscription: true },
      { method: "api_key", label: "Anthropic API key", subscription: false },
    ],
  };
  const lists = [[anthropic], [{ ...anthropic, stored: "api_key" as const }]];
  api.listProviders = async () => lists.shift()!;
  await store.loadProviders();
  const answers: [string, string][] = [];
  api.answerLogin = async (id, value) => void answers.push([id, value]);
  const done = deferred<LoginOutcome>();
  api.login = () => done.promise;

  const connecting = store.connect(anthropic, anthropic.ways[1]!);
  step({ type: "prompt", id: "1", prompt: { type: "secret", message: "Anthropic API key" } });
  step({ type: "info", message: "Keys start with sk-ant-" });
  assert.equal(store.getSnapshot().signIn?.prompt?.prompt.type, "secret");
  await store.answerSignIn("sk-ant-typed");
  assert.deepEqual(answers, [["1", "sk-ant-typed"]]);
  assert.equal(store.getSnapshot().signIn?.prompt, undefined, "the field, and what was typed, is gone");
  assert.equal(store.getSnapshot().signIn?.info?.message, "Keys start with sk-ant-");
  done.resolve({ ok: true, verified: "ok" });
  await connecting;
  assert.deepEqual(store.getSnapshot().signIn?.outcome, { ok: true, verified: "ok" });
  assert.equal(store.getSnapshot().providers?.[0]?.stored, "api_key", "the list is re-read after it lands");
  step({ type: "info", message: "late" });
  assert.equal(store.getSnapshot().signIn?.info?.message, "Keys start with sk-ant-", "a finished flow takes no more steps");
  await store.closeSignIn();
  assert.equal(store.getSnapshot().signIn, undefined);
  store.dispose();
});

test("cancelling a sign-in closes it with nothing to say; any other end keeps its reason", async () => {
  const { api, store, step } = harness();
  await store.load();
  const openai: ProviderRow = { id: "openai", name: "OpenAI", ways: [{ method: "api_key", label: "OpenAI API key", subscription: false }] };
  const running = deferred<LoginOutcome>();
  api.login = () => running.promise;
  api.cancelLogin = async () => running.resolve({ ok: false, cancelled: true });
  const first = store.connect(openai, openai.ways[0]!);
  step({ type: "prompt", id: "1", prompt: { type: "secret", message: "Key" } });
  await store.closeSignIn();
  await first;
  assert.equal(store.getSnapshot().signIn, undefined, "a decision, not a failure");

  api.login = async () => ({ ok: false, error: "EADDRINUSE: port 1455" });
  await store.connect(openai, openai.ways[0]!);
  assert.deepEqual(store.getSnapshot().signIn?.outcome, { ok: false, error: "EADDRINUSE: port 1455" });

  api.listProviders = async () => {
    throw new Error("auth.json: corrupt auth file");
  };
  await store.loadProviders();
  assert.equal(store.getSnapshot().providersError, "auth.json: corrupt auth file");
  assert.equal(store.getSnapshot().providers, undefined, "never shown as nothing connected");
  store.dispose();
});

test("starting another sign-in ends the running one first, since main runs one at a time", async () => {
  const { api, store, step } = harness();
  await store.load();
  const openai: ProviderRow = { id: "openai", name: "OpenAI", ways: [{ method: "api_key", label: "OpenAI API key", subscription: false }] };
  const xai: ProviderRow = { id: "xai", name: "xAI", ways: [{ method: "api_key", label: "xAI API key", subscription: false }] };
  const first = deferred<LoginOutcome>();
  const started: string[] = [];
  let busy = false;
  api.login = async (provider) => {
    // Main's rule: a login that starts before the last one has ended is refused.
    if (busy) return { ok: false, error: "Another sign-in is in progress." };
    busy = true;
    started.push(provider);
    if (provider === "openai") return first.promise.finally(() => (busy = false));
    return new Promise(() => {});
  };
  // Cancelling takes a moment to end in main, as closing a callback server does.
  api.cancelLogin = async () => void setTimeout(() => first.resolve({ ok: false, cancelled: true }), 10);
  const running = store.connect(openai, openai.ways[0]!);
  step({ type: "prompt", id: "1", prompt: { type: "secret", message: "Key" } });
  void store.connect(xai, xai.ways[0]!);
  await running;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["openai", "xai"]);
  assert.equal(store.getSnapshot().signIn?.provider, xai, "the new sign-in is the one on screen");
  assert.equal(store.getSnapshot().signIn?.outcome, undefined, "and it is running, not refused");
  store.dispose();
});

test("only a key question is a key step: what a flow asks after the key is its own question", async () => {
  const { api, store, step } = harness();
  await store.load();
  const answers: [string, string][] = [];
  api.answerLogin = async (id, value) => void answers.push([id, value]);
  // Runs until cancelled, as main's does.
  let end: (outcome: LoginOutcome) => void = () => {};
  api.login = () => new Promise((resolve) => (end = resolve));
  api.cancelLogin = async () => end({ ok: false, cancelled: true });
  const shown = () => keyStep(store.getSnapshot().signIn!);
  // Cloudflare: the key, then the account ID, which is not a refused key.
  const cloudflare: ProviderRow = { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", ways: [{ method: "api_key", label: "Cloudflare API key", subscription: false }] };
  void store.connect(cloudflare, cloudflare.ways[0]!);
  step({ type: "prompt", id: "1", prompt: { type: "secret", message: "Cloudflare API key" } });
  assert.equal(shown(), "ask");
  await store.answerSignIn("cf-key");
  assert.equal(shown(), "checking");
  step({ type: "prompt", id: "2", prompt: { type: "text", message: "Enter Cloudflare account ID" } });
  assert.equal(shown(), undefined, "a question of its own, not the key asked again");
  await store.answerSignIn("account-1");
  assert.deepEqual(answers, [["1", "cf-key"], ["2", "account-1"]], "the account ID is what was typed for it");
  assert.equal(shown(), undefined, "waiting after the account ID is not checking a key");
  await store.closeSignIn();

  // Vertex: a refused key starts the flow over at its choice, which is a choice, not the key again.
  const vertex: ProviderRow = { id: "google-vertex", name: "Google Vertex AI", ways: [{ method: "api_key", label: "Vertex AI", subscription: false }] };
  const choice = { type: "select", message: "Auth method", options: [{ id: "api_key", label: "API key" }] } as const;
  void store.connect(vertex, vertex.ways[0]!);
  await new Promise((resolve) => setTimeout(resolve, 0));
  step({ type: "prompt", id: "3", prompt: choice });
  assert.equal(shown(), undefined);
  await store.answerSignIn("api_key");
  step({ type: "prompt", id: "4", prompt: { type: "secret", message: "Vertex API key" } });
  assert.equal(shown(), "ask");
  await store.answerSignIn("bad-key");
  step({ type: "prompt", id: "5", prompt: choice });
  assert.equal(shown(), undefined, "the choice again, not a key field that would send the key as its answer");
  await store.answerSignIn("api_key");
  step({ type: "prompt", id: "6", prompt: { type: "secret", message: "Vertex API key" } });
  assert.equal(shown(), "refused", "the key asked again after one was sent");
  store.dispose();
});

test("a blank answer is sent when the flow asks for one, and a blank key is not", async () => {
  const { api, store, step } = harness();
  await store.load();
  const copilot: ProviderRow = {
    id: "github-copilot",
    name: "GitHub Copilot",
    ways: [{ method: "oauth", label: "GitHub Copilot", subscription: true }],
  };
  const answers: [string, string][] = [];
  api.answerLogin = async (id, value) => void answers.push([id, value]);
  api.login = () => new Promise(() => {});
  void store.connect(copilot, copilot.ways[0]!);
  step({ type: "prompt", id: "1", prompt: { type: "text", message: "GitHub Enterprise URL/domain (blank for github.com)" } });
  await store.answerSignIn("");
  assert.deepEqual(answers, [["1", ""]], "blank means github.com");
  step({ type: "prompt", id: "2", prompt: { type: "secret", message: "Key" } });
  await store.answerSignIn("");
  assert.deepEqual(answers, [["1", ""]], "an empty key is not an answer");
  assert.equal(store.getSnapshot().signIn?.prompt?.id, "2", "the key field stays");
  store.dispose();
});

test("a link the browser will not open is said in the running sign-in", async () => {
  const { api, store, step } = harness();
  await store.load();
  const anthropic: ProviderRow = { id: "anthropic", name: "Anthropic", ways: [{ method: "oauth", label: "Anthropic (Claude Pro/Max)", subscription: true }] };
  api.login = () => new Promise(() => {});
  api.openLoginUrl = async () => {
    throw new Error("no application to open https");
  };
  void store.connect(anthropic, anthropic.ways[0]!);
  step({ type: "auth_url", url: "https://claude.ai/oauth/authorize" });
  await store.openLoginUrl("https://claude.ai/oauth/authorize");
  assert.equal(store.getSnapshot().signIn?.info?.message, "The browser did not open: no application to open https");
  store.dispose();
});

test("Stop before the run starts returns the message to the draft quietly; Stop after the run ended says nothing", async () => {
  const { api, store } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent = deferred<SessionResult>();
  api.send = () => sent.promise;
  api.abort = async () => {
    // main marks the send it still holds as stopped, and that send gives up before reaching the runtime
    sent.resolve({ ok: false, error: { code: "aborted", message: "Stopped before the run started", retryable: true } });
    return { ok: true };
  };
  store.setDraft("hello");
  const sending = store.send();
  assert.equal(store.getSnapshot().busy, true, "Stop is offered at once");
  await store.abort();
  await sending;
  assert.equal(c.draft, "hello");
  assert.deepEqual(c.waiting, []);
  assert.equal(store.getSnapshot().busy, false);

  api.abort = async () => ({ ok: false, error: { code: "no_active_run", message: "no active run for this session", retryable: false } });
  await store.abort();
  assert.deepEqual(c.items, [], "neither Stop is reported as a failure");
  store.dispose();
});

test("a turn that failed after taking its message can be sent again; a failure before it, or a stop, cannot", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const texts: string[] = [];
  let answer = deferred<SessionResult>();
  api.send = (_id, _session, text) => {
    texts.push(text);
    return answer.promise;
  };
  const failedRun = { ok: false as const, error: { code: "run_failed", message: "Connection error.", retryable: false } };

  store.setDraft("summarise it");
  let sending = store.send();
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u1", text: "summarise it" });
  assert.equal(store.getSnapshot().resend, undefined, "not while it runs");
  emit(c, "run_settled", { status: "failed", error: { message: "Connection error.", retryable: false } });
  answer.resolve(failedRun);
  await sending;
  assert.deepEqual(store.getSnapshot().resend, { text: "summarise it", toolsRan: false });

  store.setDraft("half-typed");
  answer = deferred<SessionResult>();
  sending = store.resend();
  assert.equal(store.getSnapshot().resend, undefined, "one retry at a time");
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u2", text: "summarise it" });
  emit(c, "run_settled", { status: "completed" });
  answer.resolve({ ok: true });
  await sending;
  assert.deepEqual(texts, ["summarise it", "summarise it"]);
  assert.equal(c.draft, "half-typed", "the draft is not Retry's");
  assert.deepEqual(
    c.items.map((item) => item.kind),
    ["user", "note", "user"],
    "the failure stays where it happened, and the message is sent as a new turn",
  );
  assert.equal(store.getSnapshot().resend, undefined, "a turn that completed has nothing to retry");

  // Refused before the run took the message (no credential): the text went back to the draft instead.
  store.setDraft("no key");
  answer = deferred<SessionResult>();
  sending = store.send();
  emit(c, "run_started");
  emit(c, "run_settled", { status: "failed", error: { message: "No API key found", retryable: false } });
  answer.resolve({ ok: false, error: { code: "run_failed", message: "No API key found", retryable: false } });
  await sending;
  assert.equal(store.getSnapshot().resend, undefined);
  assert.equal(c.draft, "no key");

  // A run the person stopped is not offered again.
  store.setDraft("");
  answer = deferred<SessionResult>();
  store.setDraft("stop me");
  sending = store.send();
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u3", text: "stop me" });
  emit(c, "run_settled", { status: "aborted" });
  answer.resolve({ ok: false, error: { code: "aborted", message: "aborted", retryable: false } });
  await sending;
  assert.equal(store.getSnapshot().resend, undefined);
  store.dispose();
});

test("Retry sends the message a steered run was answering, and knows the tools its opening message started", async () => {
  const { store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u1", text: "fix the build" });
  emit(c, "tool_started", { id: "t1", name: "bash", args: {} });
  emit(c, "tool_finished", { id: "t1", isError: false, content: "ok" });
  emit(c, "user_message", { entryId: "u2", text: "and push it" });
  emit(c, "run_settled", { status: "failed", error: { message: "Connection error.", retryable: false } });
  assert.deepEqual(store.getSnapshot().resend, { text: "and push it", toolsRan: true });
  store.dispose();
});

test("a run this window joined midway is not offered again: where it began, and whether it took a message, are unknown", async () => {
  for (const history of [
    // Reopened after the run used a tool and was steered.
    [
      { id: "u1", timestamp: 1, kind: "user", data: { text: "fix the build" } },
      { id: "a1", parentId: "u1", timestamp: 2, kind: "assistant", data: { text: "", toolCalls: [{ id: "t1", name: "bash" }] } },
      { id: "r1", parentId: "a1", timestamp: 3, kind: "tool", data: { toolCallId: "t1", toolName: "bash", text: "ok" } },
      { id: "u2", parentId: "r1", timestamp: 4, kind: "user", data: { text: "and push it" } },
    ],
    // Reopened before the run took its message: the last user entry is the previous, finished turn's.
    [
      { id: "u1", timestamp: 1, kind: "user", data: { text: "delete the old branch" } },
      { id: "a1", parentId: "u1", timestamp: 2, kind: "assistant", data: { text: "done" } },
    ],
  ]) {
    const { api, store, emit } = harness();
    api.openAgent = async () => listed("s1");
    api.openSession = async () =>
      ({ state: { status: "running", pending: { steering: [], followUp: [] } }, entries: { entries: history } }) as never;
    await store.load();
    const c = store.getSnapshot().conversation!;
    emit(c, "user_message", { entryId: "u9", text: "a steer it took while joined" });
    emit(c, "run_settled", { status: "failed", error: { message: "No API key found", retryable: false } });
    assert.equal(store.getSnapshot().resend, undefined);
    store.dispose();
  }
});

test("a run that failed while the person was elsewhere shows its failure, and Retry, when they come back", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent = deferred<SessionResult>();
  api.send = () => sent.promise;
  store.setDraft("hello");
  const sending = store.send();
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u1", text: "hello" });
  await store.selectAgent("b");
  emit(c, "run_settled", { status: "failed", error: { message: "Connection error.", retryable: true } });
  sent.resolve({ ok: false, error: { code: "run_failed", message: "Connection error.", retryable: true } });
  await sending;
  // FastAgent's history, which now says how the answer ended.
  api.openSession = async () =>
    ({
      state: { status: "idle", pending: { steering: [], followUp: [] } },
      entries: {
        entries: [
          { id: "u1", timestamp: 1, kind: "user", data: { text: "hello" } },
          { id: "a1", parentId: "u1", timestamp: 2, kind: "assistant", data: { text: "", outcome: { status: "failed", error: { message: "Connection error." } } } },
        ],
      },
    }) as never;
  await store.selectAgent("a");
  const back = store.getSnapshot().conversation!;
  assert.notEqual(back, c, "read back from history, not the view that was let go");
  const last = back.items.at(-1);
  assert.equal(last?.kind === "note" && last.text, "run failed: Connection error.");
  assert.deepEqual(store.getSnapshot().resend, { text: "hello", toolsRan: false });
  store.dispose();
});

test("an agent's row does not call a conversation cut short while its run is still going", async () => {
  for (const status of ["running", "idle"] as const) {
    const { api, store } = harness();
    api.openAgent = async (id) => (id === "b" ? listed("b1") : ready);
    api.readSession = async () => ({ entries: [{ id: "u1", timestamp: 1, kind: "user", data: { text: "fix the build" } }] });
    api.readState = async () => ({ status, pending: { steering: [], followUp: [] } });
    await store.load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      store.getSnapshot().previews["b"]?.text,
      status === "running" ? "You: fix the build" : "This run was cut short",
      status,
    );
    store.dispose();
  }
});

test("a conversation compacting is not running: a turn cut before the compaction still says so", async () => {
  const { api, store } = harness();
  api.openAgent = async () => listed("s1");
  api.openSession = async () =>
    ({
      state: { status: "compacting", pending: { steering: [], followUp: [] } },
      entries: { entries: [{ id: "u1", timestamp: 1, kind: "user", data: { text: "fix the build" } }] },
    }) as never;
  await store.load();
  const last = store.getSnapshot().conversation!.items.at(-1);
  assert.equal(last?.kind === "note" && last.text, "run cut short: no answer was recorded");
  store.dispose();
});

test("a fresh start stays chosen across a reload or restart, until another conversation is opened", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) },
    configurable: true,
  });
  try {
    // `s1` is the newest conversation, the one that crashed the window.
    const first = harness();
    first.api.openAgent = async () => listed("s1");
    await first.store.load({ fresh: true });
    const started = first.store.getSnapshot().conversation!.session;
    first.store.dispose();

    const reloaded = harness();
    reloaded.api.openAgent = async () => listed("s1");
    await reloaded.store.load();
    assert.equal(reloaded.store.getSnapshot().conversation?.session, started, "not the newest, which crashed it");
    assert.ok(!reloaded.opens.includes("s1"));
    // Choosing the old one is the person's call, and from then on it is the one returned to.
    await reloaded.store.open("s1");
    reloaded.store.dispose();

    const later = harness();
    later.api.openAgent = async () => listed("s1");
    await later.store.load();
    assert.equal(later.store.getSnapshot().conversation?.session, "s1");
    later.store.dispose();
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("a fresh start opens the agent on a new conversation, not the one it was left on", async () => {
  const { api, store, opens } = harness();
  api.openAgent = async () => listed("s1");
  await store.load({ fresh: true });
  const c = store.getSnapshot().conversation!;
  assert.notEqual(c.session, "s1");
  assert.ok(!opens.includes("s1"), "the conversation it crashed on is not opened");
  assert.equal(store.getSnapshot().pane, "start");
  store.dispose();
});

test("a failure about another conversation is said there, and a refusal said before is said again", async () => {
  const { api, store } = harness();
  api.openAgent = async (id) => (id === "b" ? listed("b1") : ready);
  await store.load();
  const c = store.getSnapshot().conversation!;
  // Deleting a conversation of an agent that is not open: said by what it was, not in the open transcript,
  // and not as that agent's list failing to read.
  api.deleteSession = async () => ({ ok: false, error: { code: "busy", message: "b1 is running", retryable: true } });
  await store.deleteSession("b", "b1");
  assert.deepEqual(store.getSnapshot().failure, { title: "The conversation was not deleted", reason: "b1 is running" });
  assert.equal(store.getSnapshot().sessionsError["b"], undefined);
  assert.equal(c.items.length, 0, "the open transcript is not where it goes");

  // The same refusal twice is said twice: each send says how it ended.
  const busy = { ok: false as const, error: { code: "agent_changing", message: "Agent settings are changing; try again.", retryable: true } };
  api.send = async () => busy;
  for (const text of ["first", "second"]) {
    store.setDraft(text);
    await store.send();
  }
  const refusals = c.items.filter((item) => item.kind === "note" && item.reason === busy.error.message);
  assert.equal(refusals.length, 2);
  assert.ok(refusals.every((item) => item.kind === "note" && item.title === "Not sent"));
  assert.equal(c.draft, "second", "and the refused message is back in the draft");
  store.dispose();
});

test("the model's silence counts from its own output: a steer, or the person's message entering, does not reset it", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  api.send = async () => ({ ok: true });
  store.setDraft("start");
  const opening = store.send();
  assert.ok(c.heard !== undefined, "a new run counts from its message");
  emit(c, "run_started");
  emit(c, "user_message", { entryId: "u1", text: "start" });
  await opening;
  const quietSince = c.heard!;
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.setDraft("are you stuck?");
  await store.send();
  emit(c, "queue_changed", { steering: ["are you stuck?"], followUp: [] });
  emit(c, "user_message", { entryId: "u2", text: "are you stuck?" });
  assert.equal(c.heard, quietSince, "the person's own steer is not the model answering");
  emit(c, "message_delta", { channel: "text", delta: "no" });
  assert.ok(c.heard! > quietSince, "the model's output is");
  store.dispose();
});

test("a send refused because the model cannot run opens the picker on it, and writes nothing in the conversation", async () => {
  const { api, store } = harness();
  api.openSession = async () => ({ ...empty(), state: { ...empty().state, model: "anthropic/claude-sonnet-4-5" } });
  await store.load();
  const c = store.getSnapshot().conversation!;
  api.send = async () => ({
    ok: false,
    error: { code: "model_unavailable", message: "anthropic/claude-sonnet-4-5 cannot run: …", retryable: true },
  });
  store.setDraft("Summarise the latest notes");
  await store.send();
  const asked = store.getSnapshot().unavailable;
  assert.equal(asked?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(asked?.session, c.session);
  assert.equal(store.getSnapshot().picker, true, "the picker opens on it");
  assert.equal(c.items.length, 0, "nothing happened in the conversation, so nothing is written there");
  assert.equal(c.draft, "Summarise the latest notes", "the message waits for the model to be chosen");
  // Choosing a model is the way on, and ends the request.
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().unavailable, undefined);
  store.dispose();
});

test("the picker opens for a conversation that needs a model, stays closed once closed, and opens when asked", async () => {
  const { api, store } = harness();
  api.openAgent = async () => ({ ok: true, sessions: [] });
  await store.load();
  assert.equal(store.getSnapshot().needsModel, true, "no model recorded and no default");
  assert.equal(store.getSnapshot().picker, true, "a conversation that cannot start asks for its model");
  store.closePicker();
  store.setDraft("hello");
  assert.equal(store.getSnapshot().picker, false, "closed by the person, it stays closed while nothing changes");
  await store.newConversation();
  assert.equal(store.getSnapshot().picker, true, "another conversation that needs a model asks again");
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().needsModel, false);
  assert.equal(store.getSnapshot().picker, false, "a chosen model closes it");
  store.openPicker();
  assert.equal(store.getSnapshot().picker, true, "a problem's Use another model, or a provider connected from it, opens it");
  store.dispose();
});

test("the model cannot be changed while the conversation runs, or before its agent is ready", async () => {
  const { api, store, emit } = harness();
  api.listAgents = async () => [];
  await store.load();
  assert.equal(store.getSnapshot().modelBlocked, "Select an agent first");
  api.listAgents = async () => [{ id: "a", name: "A", dir: "/a", colour: 0 }];
  await store.load();
  assert.equal(store.getSnapshot().modelBlocked, undefined);
  emit(store.getSnapshot().conversation!, "run_started");
  assert.equal(store.getSnapshot().modelBlocked, "Stop the turn to change the model or effort");
  store.dispose();
});
