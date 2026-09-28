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

test("accepting a name leaves the cursor where arguments go, in the spelling the engine runs", () => {
  assert.equal(complete({ name: "commit", source: "prompt" }), "/commit ");
  // pi runs a skill as `/skill:<name>`; a bare `/weather` would reach the model as plain text.
  assert.equal(complete({ name: "weather", source: "skill" }), "/skill:weather ");
});

test("a skill is found by its name and by the spelling that runs it", () => {
  const skills = [{ name: "weather", source: "skill" }];
  assert.deepEqual(matches(skills, "wea").map((c) => c.name), ["weather"]);
  assert.deepEqual(matches(skills, "skill:w").map((c) => c.name), ["weather"]);
});
