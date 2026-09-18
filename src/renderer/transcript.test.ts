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
  assert.deepEqual(
    items.map((i) => i.kind),
    ["thinking", "assistant"],
  );
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
    { id: "2", timestamp: 0, kind: "assistant", data: { text: "yo" } },
    { id: "3", timestamp: 0, kind: "model_change", data: {} },
  ]);
  assert.deepEqual(items, [
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "yo", open: false },
  ]);
});

test("a history tool call and its result become one finished row", () => {
  const items = fromEntries([
    { id: "1", timestamp: 0, kind: "assistant", data: { text: "", toolCalls: [{ id: "t1", name: "bash" }] } },
    { id: "2", timestamp: 0, kind: "tool", data: { toolCallId: "t1", toolName: "bash", isError: false, text: "ok" } },
  ]);
  assert.deepEqual(items, [
    { kind: "tool", id: "t1", name: "bash", args: undefined, result: "ok", isError: false, status: "done" },
  ]);
});

test("a result with no call still shows, and an error is marked", () => {
  const items = fromEntries([
    { id: "1", timestamp: 0, kind: "tool", data: { toolCallId: "t9", toolName: "read", isError: true, text: "boom" } },
  ]);
  assert.equal(items.length, 1);
  assert.equal((items[0] as { isError?: boolean }).isError, true);
});

test("tool progress is a snapshot, not completion; settlement closes unfinished output", () => {
  let items = apply([], event("tool_started", { id: "t", name: "read" }));
  items = apply(items, event("tool_progress", { id: "t", partialResult: "partial" }));
  assert.equal((items[0] as Extract<Item, { kind: "tool" }>).status, "running");
  items = apply(items, event("message_delta", { channel: "thinking", delta: "reasoning" }));
  items = apply(items, event("message_delta", { channel: "text", delta: "partial answer" }));
  items = apply(items, event("run_settled", { status: "aborted", error: { message: "This operation was aborted" } }));
  assert.equal((items[0] as Extract<Item, { kind: "tool" }>).status, "interrupted");
  assert.ok(items.every((item) => (item.kind === "thinking" || item.kind === "assistant" ? !item.open : true)));
  // Stopping is the person's own action: the abort machinery's wording adds nothing they can use.
  assert.deepEqual(items.at(-1), { kind: "note", text: "run aborted" });
});

test("history follows the active leaf instead of flattening sibling branches", () => {
  const entries = [
    { id: "root", timestamp: 0, kind: "user", data: { text: "question" } },
    { id: "a", parentId: "root", timestamp: 1, kind: "assistant", data: { text: "old answer" } },
    { id: "b", parentId: "root", timestamp: 2, kind: "assistant", data: { text: "active answer" } },
  ];
  assert.deepEqual(fromEntries(entries, "b"), [
    { kind: "user", text: "question" },
    { kind: "assistant", text: "active answer", open: false },
  ]);
  assert.throws(() => fromEntries(entries, "missing"), /Invalid session entry chain/);
  assert.throws(() => fromEntries([{ ...entries[0]!, parentId: "root" }], "root"), /Invalid session entry chain/);
});

test("retry and serving failures preserve the runtime's original message", () => {
  assert.deepEqual(apply([], event("retry_scheduled", { attempt: 1, maxAttempts: 3, error: "429 quota" })), [
    { kind: "note", text: "retrying 1/3: 429 quota" },
  ]);
  assert.deepEqual(apply([], event("serving_error", { message: "disk is full" })), [
    { kind: "note", text: "disk is full" },
  ]);
});
