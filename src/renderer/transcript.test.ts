import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, fromEntries, type Item } from "./transcript.ts";

const event = (type: string, data: Record<string, unknown>) => ({ type, timestamp: 0, data }) as never;

test("deltas accumulate into one message and close on finish", () => {
  let items: Item[] = [];
  items = apply(items, event("message_delta", { channel: "text", delta: "He" }));
  items = apply(items, event("message_delta", { channel: "text", delta: "llo" }));
  assert.deepEqual(items, [{ kind: "assistant", text: "Hello", open: true }]);

  items = apply(items, event("message_finished", {}));
  items = apply(items, event("message_delta", { channel: "text", delta: "next" }));
  assert.equal(items.length, 2, "a finished message is not appended to");
});

test("thinking and text are separate items", () => {
  let items: Item[] = [];
  items = apply(items, event("message_delta", { channel: "thinking", delta: "hmm" }));
  items = apply(items, event("message_delta", { channel: "text", delta: "hi" }));
  assert.deepEqual(items.map((i) => i.kind), ["thinking", "assistant"]);
});

test("a tool result lands on the call it belongs to", () => {
  let items: Item[] = [];
  items = apply(items, event("tool_started", { id: "a", name: "read" }));
  items = apply(items, event("tool_started", { id: "b", name: "bash" }));
  items = apply(items, event("tool_finished", { id: "a", isError: false, content: "ok" }));
  const first = items[0] as Extract<Item, { kind: "tool" }>;
  const second = items[1] as Extract<Item, { kind: "tool" }>;
  assert.equal(first.result, "ok");
  assert.equal(second.result, undefined);
});

test("only a failed run leaves a note", () => {
  assert.equal(apply([], event("run_settled", { status: "completed" })).length, 0);
  const failed = apply([], event("run_settled", { status: "failed", error: { message: "boom" } }));
  assert.deepEqual(failed, [{ kind: "note", text: "run failed: boom" }]);
});

test("unknown event types change nothing", () => {
  const items: Item[] = [{ kind: "user", text: "x" }];
  assert.equal(apply(items, event("something_new", {})), items);
});

test("history keeps the guaranteed kinds and skips the rest", () => {
  const items = fromEntries([
    { id: "1", timestamp: 0, kind: "user", data: { text: "hi" } },
    { id: "2", timestamp: 0, kind: "assistant", data: { content: [{ text: "yo" }] } },
    { id: "3", timestamp: 0, kind: "engine_private", data: {} },
  ]);
  assert.deepEqual(items, [
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "yo", open: false },
  ]);
});
