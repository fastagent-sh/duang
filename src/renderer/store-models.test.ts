import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionResult } from "@fastagent-sh/fastagent/session";
import type { Models } from "../preload/index.ts";
import { deferred, described, empty, harness, ready } from "./store-harness.ts";


test("an agent whose default model pi does not know opens, with the picker open on it, until another is chosen", async () => {
  const { api, store } = harness();
  api.openAgent = async (id) =>
    id === "a" ? { ok: true, sessions: [], model: "provider/model", staleDefault: "local/gone" } : { ok: true, sessions: [], model: "provider/model" };
  await store.load();
  assert.equal(store.getSnapshot().pane, "start", "the agent opens on its own model");
  assert.deepEqual(store.getSnapshot().modelAsk, { reason: "gone", model: "local/gone" });
  assert.equal(store.getSnapshot().picker, true, "a model is asked for, though the agent has one to run");
  await store.selectAgent("b");
  assert.equal(store.getSnapshot().modelAsk, undefined, "another agent's default is fine");
  await store.selectAgent("a");
  assert.equal(store.getSnapshot().picker, true, "and asked again on coming back while it is still gone");
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().modelAsk, undefined, "a chosen model is the default now");
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
  assert.equal(store.getSnapshot().models, undefined, "agent B never presents agent A's list as its own");
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
  assert.deepEqual(store.getSnapshot().modelAsk, { reason: "refused", model: "anthropic/claude-sonnet-4-5" });
  assert.equal(store.getSnapshot().picker, true, "the picker opens on it");
  assert.equal(c.items.length, 0, "nothing happened in the conversation, so nothing is written there");
  assert.equal(c.draft, "Summarise the latest notes", "the message waits for the model to be chosen");
  // Choosing a model is the way on, and ends the request.
  await store.pickModel("provider/model");
  assert.equal(store.getSnapshot().modelAsk, undefined);
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
