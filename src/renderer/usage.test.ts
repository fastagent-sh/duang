import assert from "node:assert/strict";
import { test } from "node:test";
import { pace, paceLabel, resetLabel, tokens } from "./usage.ts";

const HOUR = 3600;
const DAY = 24 * HOUR;

test("pace is used minus the elapsed share, and only for windows of a day or more", () => {
  const resetsAt = Date.UTC(2026, 8, 25, 12);
  const week = { label: "7d", percent: 18, resetsAt, windowSeconds: 7 * DAY };
  // Six of seven days gone (85.7%) with 18% used: well under pace.
  const now = resetsAt - DAY * 1000;
  assert.equal(paceLabel(pace(week, now)!), "▼67.7%");
  // One day in (14.3%) with 18% used: slightly ahead.
  assert.equal(paceLabel(pace(week, resetsAt - 6 * DAY * 1000)!), "▲3.7%");
  assert.equal(pace({ ...week, label: "5h", windowSeconds: 5 * HOUR }, now), undefined);
  assert.equal(pace({ ...week, resetsAt: undefined }, now), undefined);
});

test("a reset reads as a time inside a day, and as a weekday beyond one", () => {
  const resetsAt = new Date(2026, 8, 25, 3, 59).getTime(); // a Friday, local time
  assert.equal(resetLabel({ label: "5h", percent: 4, resetsAt, windowSeconds: 5 * HOUR }), "03:59");
  assert.equal(resetLabel({ label: "7d", percent: 18, resetsAt, windowSeconds: 7 * DAY }), "Fri 03:59");
  assert.equal(resetLabel({ label: "7d", percent: 18, windowSeconds: 7 * DAY }), undefined);
});

test("a context window prints the way model pages print it", () => {
  assert.equal(tokens(1_000_000), "1.0M");
  assert.equal(tokens(200_000), "200K");
});
