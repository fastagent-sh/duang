import assert from "node:assert/strict";
import { test } from "node:test";
import { follow } from "./follow.ts";

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
