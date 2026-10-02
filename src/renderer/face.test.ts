import assert from "node:assert/strict";
import { test } from "node:test";
import { faceOf } from "./face.ts";

const ready = { state: "ready" as const, outcomes: [], open: false };

test("an agent's face is what it most asks of the person: setup, then work, then an outcome, then being open", () => {
  assert.equal(faceOf(ready), "idle");
  assert.equal(faceOf({ ...ready, open: true }), "open");
  assert.equal(faceOf({ ...ready, outcomes: ["done"], open: true }), "done", "an outcome waiting beats being open");
  assert.equal(faceOf({ ...ready, outcomes: ["done", "failed"] }), "failed", "one failure among them is what it shows");
  assert.equal(faceOf({ ...ready, outcomes: ["failed"], doing: "reading" }), "tool", "work in flight beats an older outcome");
  assert.equal(faceOf({ ...ready, state: "missing_model", doing: "thinking" }), "asleep", "a setup problem beats everything");
  assert.equal(faceOf({ ...ready, state: "no_agent" }), "unborn");
  assert.equal(faceOf({ ...ready, state: "broken", outcomes: ["done"] }), "broken");
});

test("the run's own word decides how it works: thinking, using a tool, or answering", () => {
  for (const word of ["thinking", "starting", "compacting"]) assert.equal(faceOf({ ...ready, doing: word }), "thinking", word);
  for (const word of ["reading", "searching", "editing", "running", "fetching", "running 3 tools"])
    assert.equal(faceOf({ ...ready, doing: word }), "tool", word);
  assert.equal(faceOf({ ...ready, doing: "answering" }), "answering");
});
