import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry, SessionResult } from "@fastagent-sh/fastagent/session";
import type { DuangApi, LoginOutcome, Models, LoginStep, OpenResult, ProviderRow, SessionFrame } from "../preload/index.ts";
import { queueView } from "./transcript.ts";
import { deferred, described, empty, harness, listed, panes, ready } from "./store-harness.ts";


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


test("a draft save failure is visible, keeps the text, and clears after storage recovers", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let failing = false;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem(key: string, value: string) {
        if (failing && key === "duang.drafts") throw new Error("storage full");
        values.set(key, value);
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const { store } = harness();
  t.after(store.dispose);
  await store.load();
  failing = true;
  store.setDraft("keep this text");
  assert.equal(store.getSnapshot().conversation?.draft, "keep this text");
  assert.match(store.getSnapshot().draftsError ?? "", /storage full/);
  failing = false;
  store.setDraft("keep this text");
  assert.equal(store.getSnapshot().draftsError, undefined);
  assert.match(values.get("duang.drafts") ?? "", /keep this text/);
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
  // A failed stream waits for the person, and the run controls must not wait for `run_settled`.
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

  // Only a turn in flight keeps an unwatched conversation alive, so the run starts before leaving.
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

  // Never opened here: said by what it was, not as B's list failing.
  api.renameSession = async () => ({ ok: false, error: { code: "busy", message: "session is busy", retryable: true } });
  await store.renameSession("b", "never-opened", "Named");
  assert.deepEqual(store.getSnapshot().failure, { title: "The conversation was not renamed", reason: "session is busy" });
  assert.equal(store.getSnapshot().sessionsError["b"], undefined, "the list was read; this is not that");
  assert.equal(store.getSnapshot().error, undefined, "and not into the banner with someone else's Retry");
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


test("the conversation a row quotes is the one a click opens, even one only unsent text still keeps alive", async () => {
  const { api, store } = harness();
  api.openAgent = async (id) => (id === "b" ? listed("b-newest") : ready);
  await store.load();
  await store.selectAgent("b");
  await store.newConversation();
  const unborn = store.getSnapshot().conversation!.session;
  store.setDraft("still unsent");
  await store.selectAgent("a");
  // The runtime never heard of it, and this window released it: the unsent text is what keeps it the one to open.
  assert.equal(store.getSnapshot().sessions["b"]?.some((s) => s.session === unborn), false);
  assert.equal(store.sessionFor("b"), unborn);
  await store.selectAgent("b");
  assert.equal(store.getSnapshot().conversation?.session, unborn, "a click opens the conversation the row quoted");
  assert.equal(store.getSnapshot().conversation?.draft, "still unsent");
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


test("a failure about another conversation is said there, and a refusal said before is said again", async () => {
  const { api, store } = harness();
  api.openAgent = async (id) => (id === "b" ? listed("b1") : ready);
  await store.load();
  const c = store.getSnapshot().conversation!;
  // Not open: said by what it was, not in the open transcript nor as B's list failing.
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
