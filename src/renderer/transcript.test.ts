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
  // Thinking still going is what the agent is doing now: the line it is on.
  items = [...items, { kind: "thinking", text: "first\nnow the build", open: true, at: 2, started: 2 }];
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
});

test("the live status says what the run is doing now", () => {
  const answering: Item = { kind: "assistant", text: "x", open: true, at: 0 };
  const thinking: Item = { kind: "thinking", text: "first\nnow the tests", open: true, started: 0, at: 0 };
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

  // pi retried twice, then gave up: only the last failure is the run's, and it is offered again.
  const gaveUp = fromEntries([
    entry("1", "user", { text: "summarise it" }),
    failed("2", "Connection error."),
    failed("3", "Connection error."),
    failed("4", "Connection error."),
  ]);
  assert.deepEqual(notes(gaveUp), [
    ["info", "retried: Connection error."],
    ["info", "retried: Connection error."],
    ["error", "run failed: Connection error."],
  ]);
  assert.deepEqual((gaveUp.at(-1) as { resend?: unknown }).resend, { text: "summarise it", toolsRan: false });

  // Still running: the last failure is a retry waiting out its delay, not the run's ending.
  assert.deepEqual(
    notes(fromEntries([entry("1", "user", { text: "summarise it" }), failed("2", "overloaded")], undefined, true)),
    [["info", "retried: overloaded"]],
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
