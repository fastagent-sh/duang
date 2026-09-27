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
    providerUsage: async (provider) => ({ provider, fetchedAt: 0 }),
    getSettings: async () => ({ network: { mode: "automatic" }, route: { source: "system" } }),
    setNetwork: async () => ({ source: "system" }),
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
  await store.deleteSession(old.agentId, old.session);
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
    id === "b" ? { ok: false, code: "failed", message: "runtime would not start" } : ready;

  await store.listSessions("b");
  assert.equal(store.getSnapshot().sessionsError["b"], "runtime would not start");
  assert.equal(store.getSnapshot().states.b, "broken", "another agent's row says its setup in words");
  // The open agent's state drives the main panel: a background re-read must not declare the
  // window broken with nothing to show for it.
  api.openAgent = async () => ({ ok: false, code: "failed", message: "runtime would not start" });
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

test("a message sent into a running turn is marked as having joined it", async () => {
  const { store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;

  store.setDraft("first");
  await store.send();
  const first = c.items.find((item) => item.kind === "user")!;
  assert.equal(first.steered, false, "a message that starts a turn joined nothing");

  emit(c, "run_started");
  store.setDraft("and also this");
  await store.send();
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  emit(c, "queue_changed", { steering: 0, followUp: 0 });
  assert.equal(c.items.filter((item) => item.kind === "user").at(-1)?.steered, true);

  // Compaction is not a run: a message sent while the context is being compacted starts a turn.
  emit(c, "run_settled", { status: "completed" });
  emit(c, "state_changed", { status: "compacting" });
  store.setDraft("after compaction started");
  await store.send();
  assert.equal(
    c.items.filter((item) => item.kind === "user").at(-1)?.steered,
    false,
    "compacting is not a run to join",
  );
  store.dispose();
});

test("a steer lands where the model read it, and one the run never read returns to the draft", async () => {
  const { store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const said = () => c.items.map((item) => (item.kind === "user" || item.kind === "assistant" ? item.text : item.kind));

  store.setDraft("start");
  await store.send();
  emit(c, "run_started");
  store.setDraft("wait");
  await store.send();
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  assert.deepEqual(c.queued.map((item) => item.text), ["wait"], "sent, but not read yet");
  // The model keeps working without it until the next turn boundary.
  emit(c, "message_delta", { channel: "text", delta: "still on the old plan" });
  emit(c, "message_finished");
  emit(c, "queue_changed", { steering: 0, followUp: 0 });
  emit(c, "message_delta", { channel: "text", delta: "stopping" });
  assert.deepEqual(said(), ["start", "still on the old plan", "wait", "stopping"]);
  assert.equal(c.queued.length, 0);

  // Walking away and back during the run keeps a waiting steer on screen.
  store.setDraft("later");
  await store.send();
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  await store.newConversation();
  await store.open(c.session);
  assert.equal(store.getSnapshot().conversation, c, "a running conversation is reused, not reloaded");
  assert.deepEqual(c.queued.map((item) => item.text), ["later"]);
  emit(c, "queue_changed", { steering: 0, followUp: 0 });

  // Stopped before the model read it: the run took the message with it.
  store.setDraft("too late");
  await store.send();
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  emit(c, "run_settled", { status: "aborted" });
  assert.equal(c.queued.length, 0);
  assert.equal(said().includes("too late"), false, "never shown as delivered");
  assert.equal(c.draft, "too late");

  // Sent as the run ended, before the runtime counted it: main starts a new turn with it.
  c.draft = "";
  emit(c, "run_started");
  store.setDraft("raced");
  await store.send();
  emit(c, "run_settled", { status: "completed" });
  const raced = c.items.at(-1);
  assert.equal(raced?.kind === "user" && raced.text, "raced");
  assert.equal(raced?.kind === "user" && raced.steered, false, "it started a turn rather than joining one");
  store.dispose();
});

test("a message joins only a run that is going or about to start, not one that just ended", async () => {
  const { api, store, emit } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const first = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => first.promise;

  store.setDraft("start");
  const sending = store.send();
  // Sent before the first message's run has started: main steers it into that run.
  api.send = async () => ({ ok: true });
  store.setDraft("early");
  await store.send();
  assert.deepEqual(c.queued.map((item) => item.text), ["early"]);
  emit(c, "run_started");
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  emit(c, "queue_changed", { steering: 0, followUp: 0 });
  emit(c, "run_settled", { status: "completed" });

  // The run is over but its send has not returned yet: main starts a new turn with this one.
  store.setDraft("next");
  await store.send();
  assert.equal(c.queued.length, 0, "nothing to wait for");
  const next = c.items.at(-1);
  assert.equal(next?.kind === "user" && next.text, "next");
  assert.equal(next?.kind === "user" && next.steered, false);
  emit(c, "run_started");
  emit(c, "message_delta", { channel: "text", delta: "answer to next" });
  assert.deepEqual(
    c.items.slice(-2).map((item) => (item.kind === "user" || item.kind === "assistant" ? item.text : item.kind)),
    ["next", "answer to next"],
    "the message sits above its own answer",
  );
  first.resolve({ ok: true });
  await sending;
  store.dispose();
});

test("steers queued before this window opened are read before its own", async () => {
  const { api, store, emit } = harness();
  api.openSession = async () => ({
    state: { status: "running" as const, activeRunId: "run", pending: { steering: 1, followUp: 0 } },
    entries: { entries: [] },
  });
  await store.load();
  const c = store.getSnapshot().conversation!;
  store.setDraft("mine");
  await store.send();
  emit(c, "queue_changed", { steering: 2, followUp: 0 });
  emit(c, "queue_changed", { steering: 1, followUp: 0 });
  assert.deepEqual(c.queued.map((item) => item.text), ["mine"], "the older, unseen steer was the one read");
  emit(c, "queue_changed", { steering: 0, followUp: 0 });
  assert.equal(c.queued.length, 0);
  const mine = c.items.at(-1);
  assert.equal(mine?.kind === "user" && mine.text, "mine");
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
  api.openAgent = async () => ({ ok: false, code: "failed", message: "runtime would not restart" });
  await store.renameSession("a", "s1", "Named");
  assert.equal(store.getSnapshot().sessionsError["a"], "runtime would not restart");

  // A conversation of another agent, never opened here: there is no transcript to put a refusal in,
  // so it goes on that agent's row rather than into the window-wide banner.
  api.renameSession = async () => ({ ok: false, error: { code: "busy", message: "session is busy", retryable: true } });
  await store.renameSession("b", "never-opened", "Named");
  assert.equal(store.getSnapshot().sessionsError["b"], "session is busy");
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
