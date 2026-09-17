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
