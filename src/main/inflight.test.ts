import assert from "node:assert/strict";
import { test } from "node:test";
import { inflight } from "./inflight.ts";

test("a call made while one runs for the same key joins it; another key, or a later call, runs on its own", async () => {
  const started: string[] = [];
  const release = new Map<string, (value: string) => void>();
  const run = inflight((key) => {
    started.push(key);
    return new Promise<string>((resolve) => release.set(key, resolve));
  });

  const first = run("a");
  const joined = run("a");
  assert.equal(joined, first, "the second call gets the first one's promise");
  const other = run("b");
  assert.deepEqual(started, ["a", "b"], "only one run per key, however many callers");
  release.get("a")!("done");
  assert.equal(await first, "done");
  release.get("b")!("other");
  assert.equal(await other, "other");

  const later = run("a");
  assert.deepEqual(started, ["a", "b", "a"], "once it has settled, the next call is a new run");
  release.get("a")!("again");
  assert.equal(await later, "again");
});

test("a failure is every joined caller's failure, and the next call tries again", async () => {
  let calls = 0;
  const run = inflight(async () => {
    calls++;
    throw new Error("could not refresh");
  });
  const results = await Promise.allSettled([run("a"), run("a")]);
  assert.deepEqual(
    results.map((r) => r.status === "rejected" && r.reason.message),
    ["could not refresh", "could not refresh"],
    "the original error reaches each of them",
  );
  assert.equal(calls, 1);
  await assert.rejects(run("a"), /could not refresh/);
  assert.equal(calls, 2, "a failed run is not remembered");
});
