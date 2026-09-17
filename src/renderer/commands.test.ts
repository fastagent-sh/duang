import assert from "node:assert/strict";
import { test } from "node:test";
import { complete, completionQuery, matches } from "./commands.ts";

const commands = [
  { name: "model", source: "builtin" },
  { name: "compact", source: "builtin" },
  { name: "commit", source: "prompt", description: "write a commit" },
];

test("a bare slash offers everything; typing narrows it", () => {
  assert.equal(completionQuery("/"), "");
  assert.deepEqual(
    matches(commands, completionQuery("/co")!).map((c) => c.name),
    ["compact", "commit"],
  );
});

test("completion stops at the first space — the rest is pi's to read", () => {
  assert.equal(completionQuery("/commit fix the parser"), undefined);
  assert.equal(completionQuery("/commit "), undefined);
});

test("a line that does not start with a slash is not a command", () => {
  assert.equal(completionQuery("hello /model"), undefined);
  assert.equal(completionQuery(""), undefined);
});

test("accepting a name leaves the cursor where arguments go", () => {
  assert.equal(complete("model"), "/model ");
});
