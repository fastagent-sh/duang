import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, dayLabel, duration, firstArg, foldHead, fromEntries, lines, previewOf, toolText, type Item } from "./transcript.ts";

const event = (type: string, data: Record<string, unknown>) => ({ type, timestamp: 0, data }) as never;

test("deltas accumulate into one message and close on finish", () => {
  let items: Item[] = [];
  items = apply(items, event("message_delta", { channel: "text", delta: "He" }));
  items = apply(items, event("message_delta", { channel: "text", delta: "llo" }));
  assert.deepEqual(items, [{ kind: "assistant", text: "Hello", open: true, at: 0 }]);

  // Settling restamps it: the time under an answer is when it landed, which is also the time
  // history will carry for it.
  items = apply(items, { type: "message_finished", timestamp: 90, data: {} } as never);
  assert.deepEqual(items, [{ kind: "assistant", text: "Hello", open: false, at: 90 }]);
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

test("thinking ends when the answer or a tool starts, and later settles do not stretch it", () => {
  const at = (type: string, timestamp: number, data: Record<string, unknown> = {}) =>
    ({ type, timestamp, data }) as never;
  let items: Item[] = [];
  items = apply(items, at("message_delta", 1_000, { channel: "thinking", delta: "plan" }));
  items = apply(items, at("message_delta", 2_000, { channel: "text", delta: "answer" }));
  items = apply(items, at("message_delta", 30_000, { channel: "text", delta: " more" }));
  items = apply(items, at("message_finished", 30_000));
  items = apply(items, at("message_delta", 40_000, { channel: "thinking", delta: "again" }));
  items = apply(items, at("tool_started", 45_000, { id: "t", name: "bash" }));
  items = apply(items, at("message_finished", 90_000));

  const [first, answer, second] = items as Extract<Item, { kind: "thinking" | "assistant" }>[];
  // Measured to where the model moved on, not to whichever message settled last.
  assert.deepEqual([first!.open, first!.at - (first as { started: number }).started], [false, 1_000]);
  assert.deepEqual([second!.open, second!.at - (second as { started: number }).started], [false, 5_000]);
  // A settled answer keeps the time it landed.
  assert.equal(answer!.at, 30_000);
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

test("a live tool keeps when it ran; one read from history has no time", () => {
  const at = (type: string, timestamp: number, data: Record<string, unknown>) => ({ type, timestamp, data }) as never;
  let items: Item[] = [];
  items = apply(items, at("tool_started", 1_000, { id: "a", name: "bash" }));
  items = apply(items, at("tool_started", 2_000, { id: "b", name: "bash" }));
  items = apply(items, at("tool_finished", 4_500, { id: "a", isError: false, content: "ok" }));
  items = apply(items, at("run_settled", 9_000, { status: "aborted" }));
  const [done, stopped] = items as Extract<Item, { kind: "tool" }>[];
  assert.deepEqual([done!.started, done!.ended], [1_000, 4_500]);
  assert.deepEqual([stopped!.status, stopped!.started, stopped!.ended], ["interrupted", 2_000, 9_000]);
  const [history] = fromEntries([
    { id: "1", timestamp: 0, kind: "assistant", data: { toolCalls: [{ id: "t", name: "bash" }] } },
    { id: "2", parentId: "1", timestamp: 5, kind: "tool", data: { toolCallId: "t", toolName: "bash", text: "ok" } },
  ]) as Extract<Item, { kind: "tool" }>[];
  assert.equal(history!.started, undefined);
});

test("a duration reads as pi writes it", () => {
  assert.equal(duration(3_240), "3.2s");
  assert.equal(duration(59_990), "60.0s");
  assert.equal(duration(125_000), "2m 5s");
  assert.equal(duration(3_725_000), "1h 2m 5s");
  // Still running, the clock ticks by the second, so it does not show tenths it cannot track.
  assert.equal(duration(2_400, true), "2s");
  assert.equal(duration(125_000, true), "2m 5s");
});

test("only a failed run leaves a note", () => {
  assert.equal(apply([], event("run_settled", { status: "completed" })).length, 0);
  const failed = apply([], event("run_settled", { status: "failed", error: { message: "boom" } }));
  assert.deepEqual(failed, [{ kind: "note", tone: "error", text: "run failed: boom", at: 0 }]);
});

test("tool output comes out of its envelope, and an unknown shape keeps its JSON", () => {
  assert.equal(toolText("plain"), "plain");
  assert.equal(toolText({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
  // The shape the runtime actually sends: content wrapping content.
  assert.equal(toolText({ content: { content: [{ type: "text", text: "deep" }], details: {} } }), "deep");
  // An image part is not text; dropping it would hide the result entirely.
  const image = { content: [{ type: "image", data: "…" }] };
  assert.equal(toolText(image), JSON.stringify(image, null, 2));
});

test("tool summaries keep the beginning of commands and the end of file paths", () => {
  const command = '/bin/sh -c "curl https://example.com/api/v1/start"';
  assert.equal(firstArg({ command }), command);
  const longCommand = command + " --header " + "x".repeat(80);
  assert.equal(firstArg({ command: longCommand }), `${longCommand.slice(0, 71)}…`);
  assert.equal(firstArg({ path: "/tmp/project/hello.txt" }), "…/project/hello.txt");
  assert.equal(firstArg({ pattern: "/api/v1/start" }), "/api/v1/start");
});

test("a preview quotes the newest output as plain text, and follows a streaming answer", () => {
  assert.equal(previewOf([]), undefined);
  let items: Item[] = [{ kind: "user", text: "Deploy it", at: 1 }];
  assert.deepEqual(previewOf(items), { text: "You: Deploy it", at: 1 });
  // An answer that has only thought so far has nothing to quote yet.
  items = [...items, { kind: "thinking", text: "hmm", open: true, at: 2, started: 2 }];
  assert.equal(previewOf(items)?.text, "You: Deploy it");
  items = [...items, { kind: "tool", id: "t", name: "bash", args: { command: "npm run build" }, status: "running", at: 3 }];
  assert.equal(previewOf(items)?.text, "bash npm run build");
  items = apply(items, { type: "message_delta", timestamp: 4, data: { delta: "## Done\n\nThe **build**" } } as never);
  assert.deepEqual(previewOf(items), { text: "Done The build", at: 4 });
  items = apply(items, { type: "message_delta", timestamp: 5, data: { delta: " passed with `0` errors." } } as never);
  assert.equal(previewOf(items)?.text, "Done The build passed with 0 errors.");
});

test("long output folds by lines and by characters, and short output does not fold", () => {
  assert.equal(foldHead("one\ntwo"), undefined);
  const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(foldHead(many)?.split("\n").length, 12);
  // One line with no ceiling — minified JSON, a curl body — is what line counting alone missed.
  const wide = "x".repeat(10_000);
  assert.equal(foldHead(wide)?.length, 1_500);
});

test("unknown event types change nothing", () => {
  const items: Item[] = [{ kind: "user", text: "x", at: 0 }];
  assert.equal(apply(items, event("something_new", {})), items);
});

test("history keeps the guaranteed kinds and skips the rest", () => {
  const items = fromEntries([
    { id: "1", timestamp: 0, kind: "user", data: { text: "hi" } },
    { id: "2", timestamp: 0, kind: "assistant", data: { text: "yo" } },
    { id: "3", timestamp: 0, kind: "model_change", data: {} },
  ]);
  assert.deepEqual(items, [
    { kind: "user", text: "hi", at: 0 },
    { kind: "assistant", text: "yo", open: false, at: 0 },
  ]);
});

test("a history tool call and its result become one finished row", () => {
  const items = fromEntries([
    { id: "1", timestamp: 0, kind: "assistant", data: { text: "", toolCalls: [{ id: "t1", name: "bash" }] } },
    { id: "2", timestamp: 0, kind: "tool", data: { toolCallId: "t1", toolName: "bash", isError: false, text: "ok" } },
  ]);
  assert.deepEqual(items, [
    { at: 0, kind: "tool", id: "t1", name: "bash", args: undefined, result: "ok", isError: false, status: "done" },
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
  assert.deepEqual(items.at(-1), { kind: "note", tone: "info", text: "run stopped", at: 0 });
});

test("history follows the active leaf instead of flattening sibling branches", () => {
  const entries = [
    { id: "root", timestamp: 0, kind: "user", data: { text: "question" } },
    { id: "a", parentId: "root", timestamp: 1, kind: "assistant", data: { text: "old answer" } },
    { id: "b", parentId: "root", timestamp: 2, kind: "assistant", data: { text: "active answer" } },
  ];
  assert.deepEqual(fromEntries(entries, "b"), [
    { kind: "user", text: "question", at: 0 },
    { kind: "assistant", text: "active answer", open: false, at: 2 },
  ]);
  assert.throws(() => fromEntries(entries, "missing"), /Invalid session entry chain/);
  assert.throws(() => fromEntries([{ ...entries[0]!, parentId: "root" }], "root"), /Invalid session entry chain/);
});

test("retry and serving failures preserve the runtime's original message", () => {
  assert.deepEqual(apply([], event("retry_scheduled", { attempt: 1, maxAttempts: 3, error: "429 quota" })), [
    { kind: "note", tone: "error", text: "retrying 1/3: 429 quota", at: 0 },
  ]);
  assert.deepEqual(apply([], event("serving_error", { message: "disk is full" })), [
    { kind: "note", tone: "error", text: "disk is full", at: 0 },
  ]);
});

test("a day boundary becomes its own line, and only where the day actually changes", () => {
  const day1 = Date.UTC(2026, 0, 19, 23, 0, 0);
  const day2 = Date.UTC(2026, 0, 21, 9, 0, 0);
  const items: Item[] = [
    { kind: "user", text: "yesterday", at: day1 },
    { kind: "assistant", text: "answer", open: false, at: day1 + 1000 },
    { kind: "user", text: "today", at: day2 },
  ];
  assert.deepEqual(
    lines(items).map((line) => (line.kind === "day" ? "—day—" : line.kind)),
    ["user", "assistant", "—day—", "user"],
  );
  // Nothing to separate inside one day.
  assert.equal(lines([items[0]!, items[1]!]).length, 2);
});

test("a day label crosses the year, not a count of days", () => {
  const jan = Date.UTC(2026, 0, 5, 12, 0, 0);
  assert.equal(dayLabel(jan, jan), "Today");
  assert.equal(dayLabel(jan - 86_400_000, jan), "Yesterday");
  // Eleven days back, but a different year: the year has to be said or it reads as this December.
  assert.match(dayLabel(Date.UTC(2025, 11, 25, 12, 0, 0), jan), /2025/);
  assert.doesNotMatch(dayLabel(Date.UTC(2026, 0, 1, 12, 0, 0), jan), /2026/);
});
