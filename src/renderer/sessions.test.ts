import assert from "node:assert/strict";
import { test } from "node:test";
import { rows } from "./sessions.ts";

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

test("a record with no message yet, made by setting its model or effort first, is listed as a new conversation", () => {
  const [row] = rows([{ session: "4f1c-uuid", createdAt: 1, updatedAt: 2, messageCount: 0 }]);
  assert.equal(row?.label, "New conversation");
  assert.equal(row?.fresh, undefined, "it is the runtime's, not one minted here");
});
