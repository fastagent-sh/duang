import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_BUSY_CODE, type Agent } from "@fastagent-sh/fastagent/core";
import type { Session, SessionResult } from "@fastagent-sh/fastagent/session";
import { send, sends } from "./send.ts";

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

test("a Stop before a send reaches the runtime keeps it from starting a run; one after it is the run's abort", async () => {
  const calls: string[] = [];
  const bound = {
    id: "s",
    state: async () => ({ status: "idle" }),
    steer: async () => {
      calls.push("steer");
      return ok;
    },
  } as unknown as Session;
  const agent = {
    async *invoke() {
      calls.push("invoke");
      yield { type: "completed" };
    },
  } as unknown as Agent;
  const noRun = async () => refusal("no_active_run");
  const held = sends();
  assert.equal((await held.stop("a/s", noRun)).ok, false, "with nothing on its way, no run is no stop");

  // Main is still resolving the proxy and opening the agent when the Stop arrives.
  let opened!: () => void;
  const opening = new Promise<void>((resolve) => (opened = resolve));
  const early = held.hold("a/s", async (stopped) => {
    await opening;
    return send(agent, bound, "hello", stopped);
  });
  assert.equal((await held.stop("b/s", noRun)).ok, false, "another conversation's send is not this one's");
  assert.equal((await held.stop("a/s", noRun)).ok, true);
  opened();
  const result = await early;
  assert.deepEqual(calls, [], "nothing reached the runtime");
  assert.equal(!result.ok && result.error.code, "aborted");

  // Once the message is the runtime's, stopping is the run's abort, and its answer is the run's.
  const late = await held.hold("a/s", (stopped) => send(agent, bound, "again", stopped));
  assert.deepEqual(calls, ["invoke"]);
  assert.equal(late.ok, true);
  const failed = refusal("run_command_failed");
  assert.equal(await held.stop("a/s", async () => failed), failed, "any other answer is passed on");
  assert.equal((await held.stop("a/s", noRun)).ok, false, "a finished send is released");
});

test("a conversation recorded on a retired provider is refused, not run there", async () => {
  const calls: string[] = [];
  const bound = { id: "s", state: async () => ({ status: "idle", model: "openai-codex/gpt-5.5" }) } as unknown as Session;
  const agent = {
    async *invoke() {
      calls.push("invoke");
      yield { type: "completed" };
    },
  } as unknown as Agent;
  const result = await send(agent, bound, "hello");
  assert.deepEqual(calls, []);
  assert.equal(!result.ok && result.error.code, "model_retired");
});
