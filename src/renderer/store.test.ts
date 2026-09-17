import assert from "node:assert/strict";
import { test } from "node:test";
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
    setModel: async () => {},
    removeAgent: async () => {},
    scaffoldAgent: async () => "/a/fastagent",
    listCommands: async () => [],
    revealAgent: async () => {},
    listModels: async () => ["provider/model"],
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
  return { api, store, emit, closed, opens };
}

test("first model selection unlocks a new conversation; configured models come from the runtime", async () => {
  const { api, store } = harness();
  api.openAgent = async () => ({ ok: false, code: "missing_model", message: "missing model" });
  await store.load();
  assert.equal(store.getSnapshot().states.a, "missing_model");
  assert.equal(store.getSnapshot().conversation, undefined);
  api.openAgent = async () => ready;
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().states.a, "ready");
  assert.equal(store.getSnapshot().model, "provider/model");
  assert.equal(store.getSnapshot().conversation?.loading, false);
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
  sent.resolve({ ok: true });
  await sending;
  assert.equal(c.state?.status, "idle");
  assert.equal(c.state?.pending.steering, 0);
  assert.equal(c.busySince, undefined);
  await store.newConversation();
  assert.ok(closed.includes(c.subscription));
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
  assert.equal(store.getSnapshot().sessions[0]?.session, "b-saved");
  store.dispose();
});

test("failed delete and abort remain visible; a stale stream never changes a reopened session", async () => {
  const { api, store, emit } = harness();
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
  emit(current, "stream_failed", { reason: "stream disconnected" });
  store.setDraft("keep me");
  await store.send();
  assert.equal(current.draft, "keep me");
  assert.equal(current.error, "stream disconnected");
  await store.retry();
  assert.equal(store.getSnapshot().conversation?.draft, "keep me");
  assert.equal(store.getSnapshot().conversation?.error, undefined);
  store.dispose();
});
