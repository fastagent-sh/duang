import assert from "node:assert/strict";
import { test } from "node:test";
import { follow, subscriptions, type Frame } from "./follow.ts";

/** A runtime's event stream that a test drives by hand, and that records being closed. */
function source(name: string) {
  const queue: (IteratorResult<string> | Error)[] = [];
  let wake: (() => void) | undefined;
  const state = { returned: false };
  const push = (value: string) => {
    queue.push({ value, done: false });
    wake?.();
  };
  const finish = () => {
    queue.push({ value: undefined, done: true });
    wake?.();
  };
  const fail = (error: Error) => {
    queue.push(error);
    wake?.();
  };
  const stream = {
    ready: Promise.resolve(),
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          const item = queue.shift()!;
          if (item instanceof Error) throw item;
          return item;
        },
        async return(): Promise<IteratorResult<string>> {
          state.returned = true;
          queue.push({ value: undefined, done: true });
          wake?.();
          return { value: undefined, done: true };
        },
      };
    },
  };
  return { name, bound: { name, events: () => stream }, push, finish, fail, state };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(opens: (() => Promise<ReturnType<typeof source>["bound"]>)[]) {
  const forwarded: string[] = [];
  const ended: [string, boolean][] = [];
  let next = 0;
  const following = follow(
    () => opens[next++]!(),
    (event: string) => forwarded.push(event),
    (reason, expected) => ended.push([reason, expected]),
  );
  return { following, forwarded, ended, opened: () => next };
}

test("rebinding moves the subscription to the new runtime and the replaced one ends silently", async () => {
  const a = source("a");
  const b = source("b");
  const { following, forwarded, ended } = harness([async () => a.bound, async () => b.bound]);
  assert.equal(await following.start(), a.bound);
  a.push("from-a");
  await tick();

  await following.rebind();
  assert.equal(a.state.returned, true, "the old runtime's stream is closed, not left listening");
  b.push("from-b");
  await tick();
  assert.deepEqual(forwarded, ["from-a", "from-b"], "one subscription, whichever runtime it is on");
  assert.deepEqual(ended, [], "the old stream finishing is the move, not an end the window should hear");
});

test("a subscription that cannot move to the new runtime ends with the reason, once", async () => {
  const a = source("a");
  const { following, ended } = harness([
    async () => a.bound,
    async () => {
      throw new Error("could not open the replacement");
    },
  ]);
  await following.start();
  await assert.doesNotReject(() => following.rebind(), "the failure is reported to the window, not thrown at the model change");
  assert.deepEqual(ended, [["Error: could not open the replacement", false]], "the original error, as a failure");
  assert.equal(a.state.returned, true, "and the stream it had is closed");
});

test("a rebind during the first listen waits for it and closes it, and the open answers from the new runtime", async () => {
  const a = source("a");
  const b = source("b");
  let release!: () => void;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const { following, forwarded, opened } = harness([
    async () => {
      await slow;
      return a.bound;
    },
    async () => b.bound,
  ]);
  const started = following.start();
  const rebound = following.rebind();
  await tick();
  assert.equal(opened(), 1, "the replacement is not opened until the first listen has finished");
  release();
  await rebound;
  assert.equal(a.state.returned, true, "the first listen is closed, not left attached to the old runtime");
  assert.equal(await started, b.bound, "the open reads from the runtime that replaced the old one");
  b.push("from-b");
  a.push("from-a");
  await tick();
  assert.deepEqual(forwarded, ["from-b"]);
});

test("closing while the runtime is still opening leaves nothing attached", async () => {
  const a = source("a");
  let release!: () => void;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const { following, forwarded, ended } = harness([
    async () => {
      await slow;
      return a.bound;
    },
  ]);
  const started = following.start();
  following.close();
  release();
  await started;
  assert.equal(a.state.returned, true);
  a.push("late");
  await tick();
  assert.deepEqual(forwarded, []);
  assert.deepEqual(ended, []);
});

test("a stream that finishes on its own is an expected end, one that throws is a failure", async () => {
  const done = source("done");
  const first = harness([async () => done.bound]);
  await first.following.start();
  done.finish();
  await tick();
  assert.deepEqual(first.ended, [["This conversation stopped receiving updates", true]]);

  const broken = source("broken");
  const second = harness([async () => broken.bound]);
  await second.following.start();
  broken.fail(new Error("socket reset"));
  await tick();
  assert.deepEqual(second.ended, [["Error: socket reset", false]]);
});

/** The table, over conversations named `agent/session`, each a hand-driven source; windows record what they hear. */
function table() {
  const opened = new Map<string, ReturnType<typeof source>>();
  const gates = new Map<string, Promise<void>>();
  const subs = subscriptions(async (agentId: string, session: string) => {
    await gates.get(`${agentId}/${session}`);
    const s = source(`${agentId}/${session}`);
    opened.set(s.name, s);
    return s.bound;
  });
  const window = (id: number) => {
    const heard: Frame<string>[] = [];
    return { id, heard, post: (frame: Frame<string>) => heard.push(frame) };
  };
  return { subs, opened, gates, window };
}

test("a subscription's frames name it; the same id opened again replaces it, and the first falls silent", async () => {
  const { subs, opened, gates, window } = table();
  const w = window(1);
  await subs.open(w, "a", "s1", "sub");
  opened.get("a/s1")!.push("one");
  await tick();
  assert.deepEqual(w.heard, [{ agentId: "a", session: "s1", subscription: "sub", event: "one" }]);

  // Reopened (a retry) while the first is still listening: the first stream closes and says nothing more.
  await subs.open(w, "a", "s2", "sub");
  assert.equal(opened.get("a/s1")!.state.returned, true);
  opened.get("a/s1")!.push("late");
  opened.get("a/s2")!.push("two");
  await tick();
  assert.deepEqual(w.heard.map((f) => f.event), ["one", "two"]);

  // Replaced while its runtime is still opening: that open rejects and nothing of it is attached.
  let release!: () => void;
  gates.set("a/slow", new Promise((resolve) => (release = resolve)));
  const superseded = subs.open(w, "a", "slow", "other");
  await subs.open(w, "a", "s3", "other");
  release();
  await assert.rejects(superseded, /superseded/);
  opened.get("a/slow")!.push("never heard");
  await tick();
  assert.ok(!w.heard.some((f) => f.session === "slow"), "nothing of the superseded open is heard");
});

test("a window's subscriptions close with it, without an ending; other windows keep theirs", async () => {
  const { subs, opened, window } = table();
  const [w1, w2] = [window(1), window(2)];
  await subs.open(w1, "a", "s1", "x");
  await subs.open(w2, "a", "s2", "x");
  subs.closeWindow(1);
  assert.equal(opened.get("a/s1")!.state.returned, true);
  assert.equal(opened.get("a/s2")!.state.returned, false);
  opened.get("a/s2")!.push("still");
  await tick();
  assert.deepEqual(w1.heard, [], "closing is not news to the one who closed");
  assert.deepEqual(w2.heard.map((f) => f.event), ["still"]);
});

test("removing an agent ends its subscriptions with the reason; a rebind moves only that agent's", async () => {
  const { subs, opened, window } = table();
  const w = window(1);
  await subs.open(w, "a", "s1", "x");
  await subs.open(w, "b", "s2", "y");

  const before = opened.get("b/s2")!;
  await subs.rebindAgent("b");
  assert.equal(before.state.returned, true, "b's old stream closed");
  assert.notEqual(opened.get("b/s2"), before, "b listens on its new runtime");
  assert.equal(opened.get("a/s1")!.state.returned, false, "a is untouched");

  subs.endAgent("a", "The agent was removed");
  assert.deepEqual(w.heard, [{ agentId: "a", session: "s1", subscription: "x", ended: { reason: "The agent was removed", expected: true } }]);
  assert.equal(opened.get("a/s1")!.state.returned, true);
  opened.get("b/s2")!.push("b lives");
  await tick();
  assert.deepEqual(w.heard.at(-1), { agentId: "b", session: "s2", subscription: "y", event: "b lives" });
});

test("a conversation that cannot be opened leaves nothing in the table, and one that ends on its own leaves it", async () => {
  const subs = subscriptions(async () => {
    throw new Error("no such runtime");
  });
  await assert.rejects(subs.open({ id: 1, post: () => {} }, "a", "s", "x"), /no such runtime/);
  await assert.doesNotReject(subs.rebindAgent("a"), "nothing left to move");

  const { subs: live, opened, window } = table();
  const w = window(1);
  await live.open(w, "a", "s", "x");
  opened.get("a/s")!.finish();
  await tick();
  assert.deepEqual(w.heard.map((f) => f.ended), [{ reason: "This conversation stopped receiving updates", expected: true }]);
  const ended = opened.get("a/s")!;
  await live.rebindAgent("a");
  assert.equal(opened.get("a/s"), ended, "an ended subscription is not reopened by a later model change");
});
