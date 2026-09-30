import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createLevelWriter } from "./level-writer.ts";

function rig(taken = true) {
  const written: string[] = [];
  const refused: string[] = [];
  const writer = createLevelWriter<string>({
    pauseMs: 150,
    write: async (target, level) => {
      written.push(`${target}:${level}`);
      return taken;
    },
    refused: (target) => refused.push(target),
  });
  return { writer, written, refused };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a click is written at once", () => {
  const { writer, written } = rig();
  writer.choose("c1", "high", false);
  assert.deepEqual(written, ["c1:high"]);
});

test("a run of keys is written once, at the stop it rested on", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { writer, written } = rig();
    writer.choose("c1", "minimal", true);
    mock.timers.tick(100);
    writer.choose("c1", "low", true);
    mock.timers.tick(100);
    writer.choose("c1", "medium", true);
    assert.deepEqual(written, [], "nothing while the keys are still going");
    mock.timers.tick(150);
    assert.deepEqual(written, ["c1:medium"]);
  } finally {
    mock.timers.reset();
  }
});

test("closing the picker writes what is waiting, and only once", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { writer, written } = rig();
    writer.choose("c1", "low", true);
    writer.flush();
    assert.deepEqual(written, ["c1:low"], "not lost to the picker closing before the pause");
    mock.timers.tick(1000);
    writer.flush();
    assert.deepEqual(written, ["c1:low"], "the pause that was still counting does not write it again");
  } finally {
    mock.timers.reset();
  }
});

test("a waiting choice is written to the conversation it was made for", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { writer, written } = rig();
    writer.choose("c1", "low", true);
    // The person is now in another conversation and chooses there: the first is not replaced, or dropped,
    // or moved onto the second.
    writer.choose("c2", "high", true);
    assert.deepEqual(written, ["c1:low"]);
    mock.timers.tick(150);
    assert.deepEqual(written, ["c1:low", "c2:high"]);
  } finally {
    mock.timers.reset();
  }
});

test("a level the runtime did not take is reported, for the conversation it was written to", async () => {
  const { writer, refused } = rig(false);
  writer.choose("c1", "xhigh", false);
  await settle();
  assert.deepEqual(refused, ["c1"]);
  const accepted = rig(true);
  accepted.writer.choose("c1", "high", false);
  await settle();
  assert.deepEqual(accepted.refused, [], "a level that was taken reports nothing");
});
