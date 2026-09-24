import assert from "node:assert/strict";
import { test } from "node:test";
import { contextLabel, errorLine, pace, paceLabel, resetLabel } from "./usage.ts";

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

test("context is how full, out of how much", () => {
  assert.equal(contextLabel(451_000, 1_000_000), "45.1%/1.0M");
  assert.equal(contextLabel(50_000, 200_000), "25.0%/200K");
});

test("an error keeps its own first line and drops the call stack pi-ai appends to it", () => {
  // Shape observed from a real expired Anthropic login whose refresh failed.
  const real =
    "ModelsError: OAuth refresh failed for anthropic: Anthropic token refresh request failed. url=https://platform.claude.com/v1/oauth/token; details=Error: fetch failed; stack=Error: fetch failed\n" +
    "    at postJson (file:///x/anthropic.js:144:28)\n    at refreshAnthropicToken (file:///x/anthropic.js:276:30)";
  assert.equal(
    errorLine(real),
    "ModelsError: OAuth refresh failed for anthropic: Anthropic token refresh request failed. url=https://platform.claude.com/v1/oauth/token; details=Error: fetch failed; stack=Error: fetch failed",
  );
  assert.equal(errorLine("api.anthropic.com answered 429: rate limited"), "api.anthropic.com answered 429: rate limited");
});
