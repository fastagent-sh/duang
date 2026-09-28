import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry, SessionResult } from "@fastagent-sh/fastagent/session";
import type { DuangApi, LoginOutcome, LoginStep, OpenResult, ProviderRow, SessionFrame } from "../preload/index.ts";
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
    listProviders: async () => [],
    revealProviders: async () => {},
    disconnect: async () => {},
    login: async () => ({ ok: true, verified: "n/a" }),
    answerLogin: async () => {},
    cancelLogin: async () => {},
    openLoginUrl: async () => {},
    onLoginStep: (fn) => {
      stepListener = fn;
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
  const step = (s: LoginStep) => stepListener(s);
  return { api, store, emit, end, step, closed, opens };
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
  emit(current, "tool_started", { id: "t", name: "bash" });
  assert.equal(store.getSnapshot().busy, true);
  // A dead subscription reports nothing further, so the run controls must not wait for `run_settled`.
  end(current, "stream disconnected", false);
  assert.equal(store.getSnapshot().busy, false);
  const tool = store.getSnapshot().conversation!.items.find((item) => item.kind === "tool");
  assert.notEqual(tool?.kind === "tool" && tool.ended, undefined, "the tool's clock stops with the stream");
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
  const askedFor: string[] = [];
  api.listModels = async (agentId) => {
    listed++;
    askedFor.push(agentId);
    return { specs: ["provider/model"], authPath: "/tmp/auth.json" };
  };
  await store.load();

  await store.loadModels();
  assert.deepEqual(store.getSnapshot().models, { specs: ["provider/model"], authPath: "/tmp/auth.json" });
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
  assert.deepEqual(c.waiting.map((item) => item.text), ["start"]);
  emit(c, "run_started");
  entered(emit, c, "start");
  emit(c, "message_delta", { channel: "text", delta: "on the old plan" });
  emit(c, "message_finished");

  // A steer waits below the output: the model keeps working without it until the next turn boundary.
  store.setDraft("wait");
  await store.send();
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

test("a send that returns after the stream ended does not claim its message ran without entering", async () => {
  const { api, store, emit, end } = harness();
  await store.load();
  const c = store.getSnapshot().conversation!;
  const sent = deferred<Awaited<ReturnType<DuangApi["send"]>>>();
  api.send = () => sent.promise;
  store.setDraft("hello");
  const sending = store.send();
  emit(c, "run_started");
  end(c, "stream disconnected", false);
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

  api.openAgent = async () => ({ ok: false, code: "failed", message: "runtime gone" });
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
  api.getSettings = async () => ({ network: { mode: "automatic" }, route: { source: "system" } });
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

test("a sign-in shows what its flow asks, sends the answer once, and ends by its outcome", async () => {
  const { api, store, step } = harness();
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
  step({ type: "progress", message: "Checking the key…" });
  assert.equal(store.getSnapshot().signIn?.prompt?.prompt.type, "secret");
  await store.answerSignIn("sk-ant-typed");
  assert.deepEqual(answers, [["1", "sk-ant-typed"]]);
  assert.equal(store.getSnapshot().signIn?.prompt, undefined, "the field, and what was typed, is gone");
  assert.equal(store.getSnapshot().signIn?.progress, "Checking the key…");
  done.resolve({ ok: true, verified: "ok" });
  await connecting;
  assert.deepEqual(store.getSnapshot().signIn?.outcome, { ok: true, verified: "ok" });
  assert.equal(store.getSnapshot().providers?.[0]?.stored, "api_key", "the list is re-read after it lands");
  step({ type: "progress", message: "late" });
  assert.equal(store.getSnapshot().signIn?.progress, "Checking the key…", "a finished flow takes no more steps");
  await store.closeSignIn();
  assert.equal(store.getSnapshot().signIn, undefined);
  store.dispose();
});

test("cancelling a sign-in closes it with nothing to say; any other end keeps its reason", async () => {
  const { api, store, step } = harness();
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

test("a blank answer is sent when the flow asks for one, and a blank key is not", async () => {
  const { api, store, step } = harness();
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

test("a link the browser will not open is said in the running dialog", async () => {
  const { api, store, step } = harness();
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
