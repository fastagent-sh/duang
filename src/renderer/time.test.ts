import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, clock, stamp } from "./time.ts";

test("relative time is coarse, and falls back to a date after a week", () => {
  const now = Date.UTC(2026, 0, 20, 12, 0, 0);
  assert.equal(ago(now - 5_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5m ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3h ago");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d ago");
  assert.match(ago(now - 30 * 86_400_000, now), /\d/);
});

test("a list stamp is the clock today, the weekday this week, and a date before that", () => {
  const now = new Date(2026, 0, 20, 12, 0, 0).getTime();
  const day = 86_400_000;
  assert.equal(stamp(now - 60_000, now), clock(now - 60_000));
  // Yesterday late evening is not "today", however few hours ago it was.
  const lateYesterday = new Date(2026, 0, 19, 23, 0, 0).getTime();
  assert.equal(stamp(lateYesterday, now), new Date(lateYesterday).toLocaleDateString([], { weekday: "short" }));
  assert.equal(stamp(now - 5 * day, now), new Date(now - 5 * day).toLocaleDateString([], { weekday: "short" }));
  // A week back is a date, with the year only when it is not this one.
  const sameYear = new Date(2026, 0, 5, 9, 0, 0).getTime();
  assert.equal(stamp(sameYear, now), new Date(sameYear).toLocaleDateString([], { month: "short", day: "numeric" }));
  assert.doesNotMatch(stamp(sameYear, now), /2026/);
  const lastYear = new Date(2025, 11, 31, 9, 0, 0).getTime();
  assert.match(stamp(lastYear, now), /2025/);
});
