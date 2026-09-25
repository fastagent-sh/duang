import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, clock, rows, stamp } from "./sessions.ts";

const summary = (session: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
  ({ session, updatedAt, createdAt: 0, messageCount: 2, ...extra }) as never;

test("newest first, and a name beats a preview", () => {
  const list = rows([summary("a", 1, { preview: "hi" }), summary("b", 2, { name: "Deploy" })]);
  assert.deepEqual(
    list.map((r) => r.label),
    ["Deploy", "hi"],
  );
});

test("a freshly minted session is shown before the runtime knows it", () => {
  const list = rows([summary("a", 1)], "new-id");
  assert.equal(list[0]?.session, "new-id");
  assert.equal(list[0]?.fresh, true);
  assert.equal(list.length, 2);
});

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
  // A week back would repeat today's weekday, so it is a date.
  assert.match(stamp(now - 7 * day, now), /\d/);
});

test("once the runtime reports it, the placeholder is gone", () => {
  const list = rows([summary("new-id", 5, { preview: "first message" })], "new-id");
  assert.deepEqual(list, [{ session: "new-id", label: "first message", updatedAt: 5 }]);
});

test("an unsettled first turn remains selectable after starting another conversation", () => {
  const list = rows([], "new", ["running"]);
  assert.deepEqual(
    list.map((row) => row.session),
    ["new", "running"],
  );
  assert.equal(list[1]?.label, "Running conversation");
  assert.equal(rows([], "running", ["running"]).length, 1);
});

test("a row says whether it is running or holding unsent text", () => {
  const list = rows([summary("live", 9, { preview: "deploy" }), summary("idle", 8, { preview: "notes" })], undefined, [
    "live",
  ], ["idle"]);
  assert.deepEqual(
    list.map((row) => [row.session, row.running ?? false, row.draft ?? false]),
    [
      ["live", true, false],
      ["idle", false, true],
    ],
  );
});
