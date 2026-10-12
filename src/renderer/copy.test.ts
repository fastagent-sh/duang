import assert from "node:assert/strict";
import { test } from "node:test";
import { copyToClipboard } from "./copy.ts";

test("copying answers what to say, and a refused clipboard is a reason rather than silence", async () => {
  assert.deepEqual(await copyToClipboard("plain text", async () => {}), { ok: true });
  assert.deepEqual(
    await copyToClipboard("plain text", async () => {
      throw new Error("Document is not focused.");
    }),
    { ok: false, error: "Document is not focused." },
  );
  // A rejection that is not an Error still says something rather than nothing.
  assert.deepEqual(await copyToClipboard("plain text", () => Promise.reject("the clipboard is gone")), {
    ok: false,
    error: "the clipboard is gone",
  });
});
