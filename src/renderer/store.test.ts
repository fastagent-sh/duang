import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionResult } from "@fastagent-sh/fastagent/session";
import type { DuangApi, OpenResult, SessionFrame } from "../preload/index.ts";
import { createStore } from "./store.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const ready: OpenResult = { ok: true, model: "provider/model", sessions: [] };
const listed = (session: string): OpenResult =>
  ({ ok: true, model: "provider/model", sessions: [{ session, updatedAt: 5, createdAt: 0, messageCount: 2 }] }) as never;
const empty = () => ({
  state: { status: "idle" as const, pending: { steering: 0, followUp: 0 } },
  entries: { entries: [] },
});
function harness() {
  let listener!: (frame: SessionFrame) => void;
  const closed: string[] = [];
  const opens: string[] = [];
  const api: DuangApi = {
    listAgents: async () => [
      { id: "a", name: "A", dir: "/a" },
      { id: "b", name: "B", dir: "/b" },
    ],
    addAgent: async () => undefined,
    openAgent: async () => ready,
    setModel: async () => ({ ok: true }) as SessionResult,
    removeAgent: async () => ({ ok: true }) as SessionResult,
    scaffoldAgent: async () => "/a/fastagent",
    listCommands: async () => [],
    revealAgent: async () => {},
    revealRegistry: async () => {},
    listModels: async () => ({ specs: ["provider/model"], authPath: "/synthetic/auth.json" }),
    deleteSession: async () => ({ ok: true }),
    openSession: async (_id, session) => {
      opens.push(session);
      return empty();
    },
    closeSession: async (subscription) => {
      closed.push(subscription);
    },
    send: async () => ({ ok: true }),
    abort: async () => ({ ok: true }),
    onSessionEvent: (fn) => {
      listener = fn;
      return () => {};
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
    expected: boolean,
  ) => {
    listener({ agentId: c.agentId, session: c.session, subscription: c.subscription, ended: { reason, expected } });
  };
  return { api, store, emit, end, closed, opens };
}

test("first model selection unlocks a new conversation; configured models come from the runtime", async () => {
  const { api, store } = harness();
  api.openAgent = async () => ({ ok: false, code: "missing_model", message: "missing model" });
  await store.load();
  assert.equal(store.getSnapshot().states.a, "missing_model");
  assert.equal(store.getSnapshot().conversation, undefined);
  assert.equal(store.getSnapshot().blocked, "pick a model to start");
  api.openAgent = async () => ready;
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().states.a, "ready");
  assert.equal(store.getSnapshot().model, "provider/model");
  assert.equal(store.getSnapshot().conversation?.loading, false);
  assert.equal(store.getSnapshot().blocked, undefined, "the one rule that disables the composer");
  store.dispose();
});

test("late agent and conversation reads cannot replace the current selection", async () => {
  const { api, store } = harness();
  const agent = deferred<OpenResult>();
  api.openAgent = async (id) => (id === "a" ? agent.promise : ready);
  const old = store.selectAgent("a");
  await store.selectAgent("b");
  agent.resolve({ ok: false, code: "failed", message: "stale failure" });
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
  assert.equal(c.busySince, undefined);
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
    assert.deepEqual(third.store.getSnapshot().draftSessions, ["kept"]);
    third.store.setDraft("");
    third.store.dispose();

    const fourth = harness();
    fourth.api.openAgent = async () => listed("kept");
    await fourth.store.load();
    assert.equal(fourth.store.getSnapshot().conversation?.draft, "");
    assert.deepEqual(fourth.store.getSnapshot().draftSessions, []);
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
  assert.deepEqual(store.getSnapshot().draftSessions, [], "another agent's drafts stay out of this list");
  await store.selectAgent("a");
  assert.deepEqual(store.getSnapshot().draftSessions, ["unsent"]);
  assert.equal(store.getSnapshot().conversation?.session, "unsent", "returning lands where you left");
  assert.equal(store.getSnapshot().conversation?.draft, "typed but never sent");
  store.setDraft("");
  await store.open("other");
  assert.deepEqual(store.getSnapshot().draftSessions, [], "an emptied draft leaves no row behind");
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
  assert.equal(store.getSnapshot().conversation?.error, "no such session");
  api.openSession = async () => empty();
  api.send = async () => {
    throw wrapped;
  };
  await store.retry();
  store.setDraft("hi");
  await store.send();
  const notes = store.getSnapshot().conversation?.items.filter((item) => item.kind === "note");
  assert.equal(notes?.at(-1)?.text, "no such session", "the banner and the transcript say the same thing");
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
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  assert.equal(c.state?.pending.steering, 1);
  await store.newConversation();
  assert.deepEqual(store.getSnapshot().runningAgents, ["a"]);
  assert.deepEqual(store.getSnapshot().runningSessions, [c.session]);
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
  assert.equal(c.state?.pending.steering, 0);
  assert.equal(c.busySince, undefined);
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
  const { api, store, emit, end } = harness();
  await store.load();
  const old = store.getSnapshot().conversation!;
  const refusal = { ok: false as const, error: { code: "busy", message: "runtime refused", retryable: true } };
  api.deleteSession = async () => refusal;
  api.abort = async () => refusal;
  await store.deleteSession(old.session);
  assert.equal(store.getSnapshot().conversation, old);
  await store.abort();
  assert.ok(old.items.some((item) => item.kind === "note" && item.text === "runtime refused"));
  await store.open(old.session);
  const current = store.getSnapshot().conversation!;
  emit(old, "message_delta", { delta: "stale" });
  assert.deepEqual(current.items, []);
  emit(current, "run_started");
  assert.equal(store.getSnapshot().busy, true);
  // A dead subscription reports nothing further, so the run controls must not wait for `run_settled`.
  end(current, "stream disconnected", false);
  assert.equal(store.getSnapshot().busy, false);
  store.setDraft("keep me");
  assert.equal(store.getSnapshot().blocked, "reconnect before sending");
  await assert.rejects(() => store.send(), /reconnect before sending/, "a blocked send is a bug, not a no-op");
  assert.equal(current.draft, "keep me");
  assert.equal(current.error, "stream disconnected");
  await store.retry();
  assert.equal(store.getSnapshot().conversation?.draft, "keep me");
  assert.equal(store.getSnapshot().conversation?.error, undefined);
  store.dispose();
});

test("an expected end of a subscription is reported without pretending the conversation failed", async () => {
  const { store, emit, end } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  emit(c, "run_started");
  end(c, "The agent's runtime was rebuilt for the new model", true);
  const current = store.getSnapshot().conversation!;
  assert.equal(current.ended, "The agent's runtime was rebuilt for the new model");
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
  assert.equal(notes.length, 2, "both refusals reached the conversation the person was looking at, verbatim");
  store.dispose();
});

test("the picker rereads models on every open, and a stale answer never lands", async () => {
  const { api, store } = harness();
  let listed = 0;
  api.listModels = async () => {
    listed++;
    return { specs: ["provider/model"], authPath: "/tmp/auth.json" };
  };
  await store.load();

  await store.loadModels();
  assert.deepEqual(store.getSnapshot().models, { specs: ["provider/model"], authPath: "/tmp/auth.json" });
  await store.loadModels();
  assert.equal(listed, 2, "a login while duang runs must show up without a restart");

  api.listModels = async () => {
    throw new Error("corrupt auth file");
  };
  await store.loadModels();
  assert.equal(store.getSnapshot().modelsError, "corrupt auth file", "the reader's own sentence, unwrapped");
  assert.equal(store.getSnapshot().models, undefined, "a failed read must not show stale models as current");

  // A slow first read must not overwrite what the reopened picker already showed.
  const slow = deferred<{ specs: string[]; authPath: string }>();
  api.listModels = () => slow.promise;
  const pending = store.loadModels();
  api.listModels = async () => ({ specs: ["provider/current"], authPath: "/tmp/auth.json" });
  await store.loadModels();
  slow.resolve({ specs: ["provider/stale"], authPath: "/tmp/old.json" });
  await pending;
  assert.deepEqual(store.getSnapshot().models?.specs, ["provider/current"]);
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
