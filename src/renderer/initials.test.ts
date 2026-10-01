import assert from "node:assert/strict";
import { test } from "node:test";
import { initials } from "./initials.ts";

test("initials are the first two letters or digits of the name, in any script, skipping punctuation", () => {
  assert.equal(initials("amazonseo.ai"), "am");
  assert.equal(initials("a-very-long-agent-name"), "av", "a hyphen is not an initial");
  assert.equal(initials(".dotfiles"), "do");
  assert.equal(initials("旅行助手"), "旅行");
  assert.equal(initials("x"), "x");
  assert.equal(initials("42-things"), "42");
  assert.equal(initials("🙂 mood"), "mo", "an emoji is not a letter either");
  assert.equal(initials("--"), "--", "a name of nothing else shows what it has");
});
