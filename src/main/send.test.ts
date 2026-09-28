import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_BUSY_CODE, type Agent } from "@fastagent-sh/fastagent/core";
import type { Session, SessionResult } from "@fastagent-sh/fastagent/session";
import { send } from "./send.ts";

const ok: SessionResult = { ok: true };
const refusal = (code: string): SessionResult => ({ ok: false, error: { code, message: code, retryable: true } });

test("send routes idle, live and both admission races without silently dropping a message", async () => {
  for (const scenario of ["idle", "running", "settled", "busy", "refused", "failed"] as const) {
    const calls: string[] = [];
    const bound = {
      id: "s",
      state: async () => ({ status: ["running", "settled", "refused"].includes(scenario) ? "running" : "idle" }),
      steer: async ({ text }: { text: string }) => {
        calls.push(`steer:${text}`);
        return scenario === "settled"
          ? refusal("no_active_run")
          : scenario === "refused"
            ? refusal("unsupported_capability")
            : ok;
      },
    } as Session;
    const agent = {
      async *invoke(_scope: unknown, { text }: { text: string }) {
        calls.push(`invoke:${text}`);
        if (scenario === "busy") yield { type: "failed", code: SESSION_BUSY_CODE, details: "busy", retryable: true };
        else if (scenario === "failed") yield { type: "failed", details: "original error", retryable: false };
        else yield { type: "completed" };
      },
    } as Agent;
    const result = await send(agent, bound, "/commit verbatim");
    const order =
      scenario === "busy"
        ? ["invoke", "steer"]
        : scenario === "settled"
          ? ["steer", "invoke"]
          : ["running", "refused"].includes(scenario)
            ? ["steer"]
            : ["invoke"];
    assert.deepEqual(
      calls,
      order.map((name) => `${name}:/commit verbatim`),
      scenario,
    );
    assert.equal(result.ok, !["failed", "refused"].includes(scenario));
    if (!result.ok && scenario === "failed") assert.equal(result.error.message, "original error");
  }
});
