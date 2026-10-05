import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@fastagent-sh/fastagent/session";
import {
  apply,
  claim,
  dayLabel,
  duration,
  firstArg,
  foldHead,
  fromEntries,
  group,
  lines,
  phase,
  summarize,
  previewOf,
  thinkingLine,
  opensRun,
  queueView,
  toolText,
  type Item,
  type UserItem,
} from "./transcript.ts";

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

test("only the active run's unanswered calls resume as running", () => {
  const items = fromEntries(
    [
      { id: "1", timestamp: 0, kind: "user", data: { text: "earlier" } },
      { id: "2", parentId: "1", timestamp: 1, kind: "assistant", data: { toolCalls: [{ id: "old", name: "bash" }] } },
      { id: "3", parentId: "2", timestamp: 2, kind: "user", data: { text: "now" } },
      { id: "4", parentId: "3", timestamp: 3, kind: "assistant", data: { toolCalls: [{ id: "new", name: "bash" }] } },
    ],
    undefined,
    true,
  );
  const status = (id: string) => (items.find((item) => item.kind === "tool" && item.id === id) as { status: string }).status;
  assert.equal(status("old"), "interrupted", "an earlier run's unanswered call stays stopped");
  assert.equal(status("new"), "running");
});

test("the runtime's queue shows this window's own messages by what was typed, and others by their text", () => {
  const typed: UserItem = { kind: "user", text: "/skill:demo", at: 1 };
  const plain: UserItem = { kind: "user", text: "and also", at: 2 };
  const unsent: UserItem = { kind: "user", text: "not listed yet", at: 3 };
  // The runtime lists a slash command expanded, and one message came from elsewhere.
  const view = queueView([typed, plain, unsent], ["Say demo.", "and also", "from elsewhere"]);
  assert.deepEqual(
    view.map(({ item, listed }) => [item.text, listed]),
    [
      ["/skill:demo", true],
      ["and also", true],
      ["from elsewhere", true],
      ["not listed yet", false],
    ],
  );
  assert.equal(claim([plain, typed], "and also"), plain, "the same text wins over the command fallback");
  assert.equal(claim([plain], "somebody else's"), undefined);
});

test("a message opens a run when there is none to join, and never a compaction it did not ask for", () => {
  assert.equal(opensRun(undefined, false), true, "a conversation not read yet");
  assert.equal(opensRun("idle", true), true, "after a run, even though it had a message");
  assert.equal(opensRun("running", false), true, "started, its message not placed yet");
  assert.equal(opensRun("running", true), false, "a steer");
  assert.equal(opensRun("compacting", false), false, "sent during a compaction");
  const opening: UserItem = { kind: "user", text: "/compact", at: 1, opens: true };
  const steer: UserItem = { kind: "user", text: "and also", at: 2, opens: false };
  assert.deepEqual(
    queueView([opening, steer], []).map(({ item, opens }) => [item.text, opens]),
    [["/compact", true], ["and also", false]],
  );
  assert.equal(queueView([opening], ["/compact"])[0]?.opens, false, "listed as queued, it is a steer");
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
  assert.deepEqual(failed, [
    { kind: "note", tone: "error", text: "run failed: boom", title: "The run stopped with an error", reason: "boom", at: 0 },
  ]);
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

test("a preview quotes the call still running, not one started after it that already finished", () => {
  const items = [
    tool("bash", { command: "sleep 6" }, { status: "running", id: "a" }),
    tool("bash", { command: "ls" }, { id: "b" }),
  ] as Item[];
  assert.equal(previewOf(items)?.text, "bash sleep 6");
  assert.equal(previewOf([items[0]!, { ...(items[1] as object), status: "running" } as Item])?.text, "bash ls");
});

test("a preview quotes the newest output as plain text, and follows a streaming answer", () => {
  assert.equal(previewOf([]), undefined);
  let items: Item[] = [{ kind: "user", text: "Deploy it", at: 1 }];
  assert.deepEqual(previewOf(items), { text: "You: Deploy it", at: 1 });
  // Thinking still going is what the agent is doing now: the line it is on.
  items = [...items, { kind: "thinking", text: "first\nnow the build\n", open: true, at: 2, started: 2 }];
  assert.equal(previewOf(items)?.text, "thinking: now the build");
  // Settled, it is not output, and is passed over.
  assert.equal(previewOf([items[0]!, { ...(items[1] as never as object), open: false } as Item])?.text, "You: Deploy it");
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
    { kind: "user", text: "hi", at: 0, entryId: "1" },
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
    { kind: "user", text: "question", at: 0, entryId: "root" },
    { kind: "assistant", text: "active answer", open: false, at: 2 },
  ]);
  assert.throws(() => fromEntries(entries, "missing"), /Invalid session entry chain/);
  assert.throws(() => fromEntries([{ ...entries[0]!, parentId: "root" }], "root"), /Invalid session entry chain/);
});

test("retry and serving failures preserve the runtime's original message; a retry is not itself a failure", () => {
  const first = apply([], event("retry_scheduled", { attempt: 1, maxAttempts: 3, error: "Anthropic API error (429): rate_limit_error" }));
  assert.deepEqual(first, [
    {
      kind: "note",
      tone: "info",
      text: "retrying 1/3: the provider is limiting requests",
      reason: "Anthropic API error (429): rate_limit_error",
      retry: 1,
      of: 3,
      at: 0,
    },
  ]);
  // A reason nothing recognises is said in its own words, never as a run that stopped: the run goes on.
  assert.deepEqual(
    apply([], event("retry_scheduled", { attempt: 1, maxAttempts: 3, error: "Request timed out" })).map((item) => item.kind === "note" && item.text),
    ["retrying 1/3: Request timed out"],
  );
  // One line that moves on with each attempt; the failure card, if it comes, keeps the provider's words.
  const second = apply(first, event("retry_scheduled", { attempt: 2, maxAttempts: 3, error: "Anthropic API error (429): rate_limit_error" }));
  assert.deepEqual(second.map((item) => item.kind === "note" && item.text), ["retrying 2/3: the provider is limiting requests"]);
  // While it waits, the live status says the retry, not "thinking".
  assert.deepEqual(phase(second, "running"), { word: "retrying 2/3", detail: "the provider is limiting requests", activity: "thinking" });
  // The run went on from it: the line says it in the past, as it reads back from history.
  const answered = apply(second, { type: "message_delta", timestamp: 1, runId: "r", data: { channel: "text", delta: "Here" } });
  assert.deepEqual(
    answered.map((item) => item.kind === "note" ? [item.text, item.of] : item.kind),
    [["retried 2 times: the provider is limiting requests", undefined], "assistant"],
  );
  assert.equal(
    (apply(second, event("tool_started", { id: "t", name: "bash", args: {} }))[0] as { text: string }).text,
    "retried 2 times: the provider is limiting requests",
  );
  const ended = apply(second, event("run_settled", { status: "failed", error: { message: "Anthropic API error (429): rate_limit_error", retryable: true } }));
  assert.deepEqual(
    ended.map((item) => item.kind === "note" && item.title),
    ["The provider is limiting requests"],
    "once the run ends, its ending says it, and the retry line goes",
  );
  assert.deepEqual(apply([], event("serving_error", { message: "disk is full" })), [
    { kind: "note", tone: "error", text: "disk is full", title: "The agent's runtime reported a problem", reason: "disk is full", at: 0 },
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

const tool = (name: string, args: unknown, extra: Partial<Extract<Item, { kind: "tool" }>> = {}): Item => ({
  kind: "tool",
  id: Math.random().toString(),
  name,
  args,
  status: "done",
  at: 0,
  ...extra,
});

test("consecutive tool calls and thinking fold into one work block, which prose ends", () => {
  const answer: Item = { kind: "assistant", text: "ok", open: false, at: 0 };
  const shown = group([tool("read", { path: "a" }), answer, tool("read", { path: "a" }), tool("bash", { command: "ls" }), answer]);
  // A lone call is a block of one, so the next call extends it rather than replacing it on screen.
  assert.deepEqual(
    shown.map((line) => (line.kind === "work" ? line.items.length : line.kind)),
    [1, "assistant", 2, "assistant"],
  );
});

test("a work block counts files once and names the kind of work", () => {
  const thinking: Item = { kind: "thinking", text: "", open: false, started: 0, at: 4000 };
  const text = summarize([
    thinking,
    tool("read", { path: "/x/a.ts" }),
    tool("read", { path: "/x/a.ts" }),
    tool("read", { path: "/x/b.ts" }),
    tool("bash", { command: "npm test" }, { isError: true }),
    tool("grep", { pattern: "foo" }),
    tool("mcp_search", {}),
    tool("mcp_search", {}),
  ] as never);
  assert.equal(text, "thought 4s, read 2 files, searched once, ran 1 command, used mcp_search \u00d72");
  // Counted by the real path: two index.ts files in different packages are two files.
  assert.equal(summarize([tool("read", { path: "/r/packages/a/src/index.ts" }), tool("read", { path: "/r/packages/b/src/index.ts" })] as never), "read 2 files");
  // The path, not whichever string argument comes first.
  assert.equal(summarize([tool("edit", { oldText: "x", path: "/a.ts" }), tool("edit", { oldText: "x", path: "/b.ts" })] as never), "changed 2 files");
  // A call that never finished is said, unlike one that failed: nothing else says the run was cut short.
  assert.equal(
    summarize([tool("bash", {}, { isError: true }), tool("bash", {}, { status: "interrupted" })] as never),
    "ran 2 commands, 1 stopped",
  );
  // History carries no arguments, so every reopened call counts on its own.
  assert.equal(summarize([tool("read", undefined), tool("read", undefined)] as never), "read 2 files");
  // A call still running is not counted as done: the block says how many run, the live status what they are.
  assert.equal(summarize([tool("bash", {}, { status: "running", id: "a" }), tool("bash", {}, { status: "running", id: "b" })] as never), "2 running");
  assert.equal(summarize([tool("bash", {}, { id: "a" }), tool("bash", {}, { status: "running", id: "b" })] as never), "ran 1 command, 1 running");
});

test("a streaming thought is quoted by a line it finished, never one cut mid-word", () => {
  // The last line is still being written: the one before it is what the model last said in full.
  assert.equal(thinkingLine("The user wants me to:\n1. Find out why it fails\n- The tot", true), "1. Find out why it fails");
  assert.equal(thinkingLine("The user wants me to:\n1. Find out why it fails\n", true), "1. Find out why it fails");
  // No line finished yet: the words so far, without the one being written.
  assert.equal(thinkingLine("Let me look at the tes", true), "Let me look at the");
  assert.equal(thinkingLine("Let me", true), "Let");
  // A spaced script's first word alone may be half-written: nothing yet.
  assert.equal(thinkingLine("Th", true), "");
  // A script written without spaces has no word to leave out: what it has written so far.
  assert.equal(thinkingLine("让我看看这个测试为什么失败", true), "让我看看这个测试为什么失败");
  // Settled, the last line is complete and is the one shown.
  assert.equal(thinkingLine("first\n- The total is right"), "- The total is right");
  // The live status and the preview read it the same way.
  const streaming: Item = { kind: "thinking", text: "first line\n- The tot", open: true, started: 0, at: 0 };
  assert.equal(phase([streaming], "running").detail, "first line");
  assert.equal(previewOf([streaming])?.text, "thinking: first line");
  assert.equal(phase([{ ...streaming, text: "" } as Item], "running").detail, undefined, "nothing worth saying yet");
  // Nothing to quote yet: the preview says thinking, not a label with nothing after it.
  assert.equal(previewOf([{ ...streaming, text: "" } as Item])?.text, "thinking");
});

test("the live status says what the run is doing now", () => {
  const answering: Item = { kind: "assistant", text: "x", open: true, at: 0 };
  const thinking: Item = { kind: "thinking", text: "first\nnow the tests\n", open: true, started: 0, at: 0 };
  const build = tool("bash", { command: "npm test" }, { status: "running", id: "t1" });
  assert.deepEqual(phase([], undefined), { word: "starting", activity: "thinking" });
  assert.deepEqual(phase([], "compacting"), { word: "compacting", activity: "thinking" });
  assert.deepEqual(phase([], "running"), { word: "thinking", detail: undefined, activity: "thinking" });
  // Thinking says the line it is on.
  assert.deepEqual(phase([thinking], "running"), { word: "thinking", detail: "now the tests", activity: "thinking" });
  assert.deepEqual(phase([answering], "running"), { word: "answering", activity: "answering" });
  assert.deepEqual(phase([build], "running"), { word: "running", detail: "npm test", activity: "tool" });
  assert.deepEqual(phase([tool("read", { path: "/a/b/c.ts" }, { status: "running", id: "r" })], "running"), {
    word: "reading",
    detail: "\u2026/b/c.ts",
    activity: "tool",
  });
  assert.deepEqual(phase([tool("read", {}, { status: "running" }), tool("bash", {}, { status: "running" })], "running"), {
    word: "running 2 tools",
    activity: "tool",
  });
});

test("history says how an answer ended, as a watcher saw it live, and offers a failed run's message again", () => {
  const entry = (id: string, kind: string, data: object) => ({ id, timestamp: Number(id), kind, data }) as SessionEntry;
  const failed = (id: string, message: string) => entry(id, "assistant", { text: "", outcome: { status: "failed", error: { message } } });
  const notes = (items: Item[]) => items.flatMap((item) => (item.kind === "note" ? [[item.tone, item.text]] : []));

  // pi retried twice, then gave up: only the last failure is the run's, it is offered again, and the line
  // counting the retries goes with it.
  const gaveUp = fromEntries([
    entry("1", "user", { text: "summarise it" }),
    failed("2", "Connection error."),
    failed("3", "Connection error."),
    failed("4", "Connection error."),
  ]);
  assert.deepEqual(notes(gaveUp), [["error", "run failed: Connection error."]], "the ending says it; the retries before it go");
  assert.deepEqual((gaveUp.at(-1) as { resend?: unknown }).resend, { text: "summarise it", toolsRan: false });

  // Still running: the last failure is a retry waiting out its delay, not the run's ending.
  assert.deepEqual(
    notes(fromEntries([entry("1", "user", { text: "summarise it" }), failed("2", "overloaded")], undefined, true)),
    [["info", "retried once: the provider had a problem"]],
  );

  // A partial answer the stream dropped, a stop, and an answer cut off at the output limit.
  const ended = fromEntries([
    entry("1", "user", { text: "a" }),
    entry("2", "assistant", { text: "partial answer", outcome: { status: "failed", error: { message: "socket hang up" } } }),
    entry("3", "user", { text: "b" }),
    entry("4", "assistant", { text: "", outcome: { status: "aborted", error: { message: "Request aborted" } } }),
    entry("5", "user", { text: "c" }),
    entry("6", "assistant", { text: "a long answ", outcome: { status: "truncated" } }),
  ]);
  assert.deepEqual(notes(ended), [
    ["error", "run failed: socket hang up"],
    ["info", "run stopped"],
    ["info", "answer cut off at the model's output limit"],
  ]);
  assert.equal(ended.find((item) => item.kind === "assistant")?.kind, "assistant", "the partial text stays, with its failure under it");

  // Work no answer concluded counts, a steer's included; work an earlier answer concluded does not.
  const tool = (id: string, call: string) => [
    entry(id, "assistant", { text: "", toolCalls: [{ id: call, name: "bash" }] }),
    entry(`${id}1`, "tool", { toolCallId: call, toolName: "bash", text: "ok" }),
  ];
  const resend = (entries: SessionEntry[]) => (fromEntries(entries).at(-1) as { resend?: unknown }).resend;
  assert.deepEqual(
    resend([entry("1", "user", { text: "fix the build" }), ...tool("2", "t1"), entry("3", "user", { text: "and push it" }), failed("4", "x")]),
    { text: "and push it", toolsRan: true },
  );
  assert.deepEqual(
    resend([
      entry("1", "user", { text: "fix the build" }),
      ...tool("2", "t1"),
      entry("3", "assistant", { text: "fixed" }),
      entry("4", "user", { text: "thanks" }),
      failed("5", "x"),
    ]),
    { text: "thanks", toolsRan: false },
  );
  assert.deepEqual(
    resend([
      entry("1", "user", { text: "one" }),
      ...tool("2", "t1"),
      failed("3", "x"),
      entry("4", "user", { text: "two" }),
      failed("5", "y"),
    ]),
    { text: "two", toolsRan: false },
    "an earlier run's failure ended its work too",
  );
});

test("an answer cut off at the output limit says so live", () => {
  let items: Item[] = [];
  items = apply(items, { type: "message_delta", timestamp: 1, runId: "r", data: { channel: "text", delta: "a long answ" } });
  items = apply(items, { type: "message_finished", timestamp: 2, runId: "r", data: { outcome: { status: "truncated" } } });
  assert.deepEqual(items.at(-1), { kind: "note", tone: "info", text: "answer cut off at the model's output limit", at: 2 });
  const failed = apply([], { type: "message_finished", timestamp: 2, runId: "r", data: { outcome: { status: "failed", error: { message: "x" } } } });
  assert.deepEqual(failed, [], "a failure is said by the run's ending, not twice");
});

test("a ChatGPT plan's usage limit names the provider whose page says more, live and read back", () => {
  const limitOfLast = (items: Item[]) => {
    const last = items.at(-1);
    return last?.kind === "note" ? last.limit : undefined;
  };
  const reason = "OpenAI API error (429): subscription_sharing_usage_limit_exceeded\nCheck your ChatGPT usage: https://chatgpt.com/settings/usage";
  const live = apply([], { type: "run_settled", timestamp: 1, runId: "r", data: { status: "failed", error: { message: reason, retryable: false } } });
  assert.equal(limitOfLast(live), "openai");
  const read = fromEntries([
    { id: "1", timestamp: 1, kind: "user", data: { text: "hi" } },
    { id: "2", parentId: "1", timestamp: 2, kind: "assistant", data: { text: "", outcome: { status: "failed", error: { message: reason } } } },
  ]);
  assert.equal(limitOfLast(read), "openai");
  const other = apply([], { type: "run_settled", timestamp: 1, runId: "r", data: { status: "failed", error: { message: "Connection error.", retryable: true } } });
  assert.equal(limitOfLast(other), undefined);
});

test("a turn cut partway with nothing recorded says so and offers its message again; a finished or running one does not", () => {
  const entry = (id: string, kind: string, data: object) => ({ id, timestamp: Number(id), kind, data }) as SessionEntry;
  const last = (items: Item[]) => items.at(-1) as Extract<Item, { kind: "note" }>;
  const cut = {
    kind: "note",
    tone: "error",
    text: "run cut short: no answer was recorded",
    title: "This run was cut short",
    advice: "duang or the computer stopped before an answer was recorded. What it did up to here is kept.",
  };
  const user = entry("1", "user", { text: "fix the build" });
  const call = entry("2", "assistant", { text: "", toolCalls: [{ id: "t1", name: "bash" }] });
  const result = entry("3", "tool", { toolCallId: "t1", toolName: "bash", text: "ok" });

  // On the message itself: quit or crashed before any answer.
  assert.deepEqual(last(fromEntries([user])), { ...cut, at: 1, resend: { text: "fix the build", toolsRan: false } });
  // On a tool's result, or on calls that never ran: the work so far may be repeated.
  assert.deepEqual(last(fromEntries([user, call, result])).resend, { text: "fix the build", toolsRan: true });
  assert.equal(last(fromEntries([user, call])).text, cut.text);

  // Answered, failed (its own note), stopped, or still running: nothing more is said.
  const answered = fromEntries([user, call, result, entry("4", "assistant", { text: "fixed" })]);
  assert.equal(answered.at(-1)?.kind, "assistant");
  assert.equal(last(fromEntries([user, entry("2", "assistant", { text: "", outcome: { status: "aborted" } })])).text, "run stopped");
  assert.equal(fromEntries([user, call, result], undefined, true).at(-1)?.kind, "tool");
  assert.deepEqual(fromEntries([]), [], "a conversation with no message yet is not cut");

  // A run its tool batch ended on purpose stops on a result too, and is not cut: every call of the answer asked.
  const two = entry("2", "assistant", { text: "", toolCalls: [{ id: "t1", name: "bash" }, { id: "t2", name: "done" }] });
  const asked = (id: string, n: string) => entry(n, "tool", { toolCallId: id, toolName: "x", text: "ok", terminate: true });
  const plain = (id: string, n: string) => entry(n, "tool", { toolCallId: id, toolName: "x", text: "ok" });
  assert.equal(fromEntries([user, two, asked("t1", "3"), asked("t2", "4")]).at(-1)?.kind, "tool", "ended on purpose: nothing to retry");
  assert.equal(last(fromEntries([user, two, plain("t1", "3"), asked("t2", "4")])).text, cut.text, "only some asked: the run went on, then was cut");
  assert.equal(last(fromEntries([user, two, asked("t1", "3")])).text, cut.text, "a call still unanswered: cut");
  // One that ended on purpose earlier, and a later turn cut, does not let the earlier batch excuse the later one.
  const later = [user, two, asked("t1", "3"), asked("t2", "4"), entry("5", "user", { text: "and again" }), entry("6", "assistant", { text: "", toolCalls: [{ id: "t3", name: "bash" }] }), plain("t3", "7")];
  assert.deepEqual(last(fromEntries(later)).resend, { text: "and again", toolsRan: true });
  // The ended batch's work is done: a later turn that ran no tool is offered again without the warning.
  const ended = [user, two, asked("t1", "3"), asked("t2", "4")];
  assert.deepEqual(last(fromEntries([...ended, entry("5", "user", { text: "and again" })])).resend, { text: "and again", toolsRan: false });
  const failedLater = [...ended, entry("5", "user", { text: "and again" }), entry("6", "assistant", { text: "", outcome: { status: "failed", error: { message: "x" } } })];
  assert.deepEqual(last(fromEntries(failedLater)).resend, { text: "and again", toolsRan: false });
});

test("a turn cut before a compaction is still cut, and its failure is not rewritten as a retry", () => {
  const entry = (id: string, kind: string, data: object) => ({ id, timestamp: Number(id), kind, data }) as SessionEntry;
  const failed = [entry("1", "user", { text: "summarise it" }), entry("2", "assistant", { text: "", outcome: { status: "failed", error: { message: "context overflow" } } })];
  // The store passes `running` only for a run; a compaction reads as not running.
  const last = fromEntries(failed, undefined, false).at(-1) as Extract<Item, { kind: "note" }>;
  assert.equal(last.text, "run failed: context overflow");
  assert.deepEqual(last.resend, { text: "summarise it", toolsRan: false });
});

test("an answer read back keeps the reasoning it recorded, as the block it was in live", () => {
  const items = fromEntries([
    { id: "1", timestamp: 1, kind: "user", data: { text: "read it" } },
    { id: "2", parentId: "1", timestamp: 2, kind: "assistant", data: { text: "", thinking: "First the file.\nThen the answer.", toolCalls: [{ id: "a", name: "read", args: { path: "/r/a.ts" } }] } },
    { id: "3", parentId: "2", timestamp: 3, kind: "tool", data: { toolCallId: "a", toolName: "read", text: "x" } },
    { id: "4", parentId: "3", timestamp: 4, kind: "assistant", data: { text: "done" } },
  ]);
  assert.deepEqual(items.map((item) => item.kind), ["user", "thinking", "tool", "assistant"], "before the calls it led to, as live");
  const thought = items[1] as Extract<Item, { kind: "thinking" }>;
  assert.equal(thought.text, "First the file.\nThen the answer.");
  assert.equal(thought.open, false);
  // How long it took is not recorded, and the block still says there was a thought.
  assert.equal(summarize(items.slice(1, 3) as never), "thought, read 1 file");
});

test("a call reopened from history keeps its arguments: its path, and the count of distinct files", () => {
  const items = fromEntries([
    { id: "1", timestamp: 1, kind: "user", data: { text: "read it" } },
    {
      id: "2",
      parentId: "1",
      timestamp: 2,
      kind: "assistant",
      data: { text: "", toolCalls: [{ id: "a", name: "read", args: { path: "/repo/src/app.ts" } }, { id: "b", name: "read", args: { path: "/repo/src/app.ts" } }] },
    },
    { id: "3", parentId: "2", timestamp: 3, kind: "tool", data: { toolCallId: "a", toolName: "read", text: "x" } },
    { id: "4", parentId: "3", timestamp: 4, kind: "tool", data: { toolCallId: "b", toolName: "read", text: "x" } },
    { id: "5", parentId: "4", timestamp: 5, kind: "assistant", data: { text: "done" } },
  ]);
  const tools = items.filter((item): item is Extract<Item, { kind: "tool" }> => item.kind === "tool");
  assert.deepEqual(tools.map((tool) => tool.args), [{ path: "/repo/src/app.ts" }, { path: "/repo/src/app.ts" }]);
  assert.equal(summarize(tools), "read 1 file", "the same file read twice is one file, reopened as live");
});
