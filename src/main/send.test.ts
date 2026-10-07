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
    const result = await send(agent, bound, "/commit verbatim", () => false, async () => true);
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
  assert.equal((await held.stop("a", "s", noRun)).ok, false, "with nothing on its way, no run is no stop");

  // Main is still resolving the proxy and opening the agent when the Stop arrives.
  let opened!: () => void;
  const opening = new Promise<void>((resolve) => (opened = resolve));
  const early = held.hold("a", "s", async (stopped) => {
    await opening;
    return send(agent, bound, "hello", stopped, async () => true);
  });
  assert.equal((await held.stop("b", "s", noRun)).ok, false, "another conversation's send is not this one's");
  assert.equal((await held.stop("a", "s", noRun)).ok, true);
  opened();
  const result = await early;
  assert.deepEqual(calls, [], "nothing reached the runtime");
  assert.equal(!result.ok && result.error.code, "aborted");

  // Once the message is the runtime's, stopping is the run's abort, and its answer is the run's.
  const late = await held.hold("a", "s", (stopped) => send(agent, bound, "again", stopped, async () => true));
  assert.deepEqual(calls, ["invoke"]);
  assert.equal(late.ok, true);
  const failed = refusal("run_command_failed");
  assert.equal(await held.stop("a", "s", async () => failed), failed, "any other answer is passed on");
  assert.equal((await held.stop("a", "s", noRun)).ok, false, "a finished send is released");
});

test("a run starts only on a model the picker would offer; a steer joins the run already going", async () => {
  const calls: string[] = [];
  let status = "idle";
  const bound = {
    id: "s",
    state: async () => ({ status, model: "anthropic/claude-sonnet-4-5" }),
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
  // Its provider was disconnected (or it is on a retired route): refused before anything is recorded.
  const refused = await send(agent, bound, "hello", () => false, async () => false);
  assert.deepEqual(calls, []);
  assert.equal(!refused.ok && refused.error.code, "model_unavailable");
  assert.match(!refused.ok ? refused.error.message : "", /^anthropic\/claude-sonnet-4-5 cannot run: .*Connect the provider/);
  status = "running";
  assert.equal((await send(agent, bound, "and this", () => false, async () => false)).ok, true);
  assert.deepEqual(calls, ["steer"]);
});

test("quitting stops every send in flight and waits for each run to settle, but not past its limit", async () => {
  const held = sends();
  assert.equal(held.busy(), false);
  const settle = new Map<string, () => void>();
  const run = (session: string) =>
    held.hold("agent", session, () => new Promise<SessionResult>((resolve) => settle.set(session, () => resolve(refusal("aborted")))));
  const a = run("a");
  const b = run("b");
  assert.equal(held.busy(), true);
  const aborted: string[] = [];
  const settled = await held.stopAll(async (agentId, session) => {
    aborted.push(`${agentId}/${session}`);
    setTimeout(() => settle.get(session)!(), 5);
    return ok;
  }, 1000);
  assert.equal(settled, true, "both runs settled before the limit");
  assert.deepEqual(aborted.sort(), ["agent/a", "agent/b"]);
  await Promise.all([a, b]);
  assert.equal(held.busy(), false);

  // Once quitting began, a message sent while it waits is refused before it reaches the runtime.
  let started = false;
  const meanwhile = await held.hold("agent", "c", async () => {
    started = true;
    return ok;
  });
  assert.equal(started, false);
  assert.equal(!meanwhile.ok && meanwhile.error.code, "quitting");
  assert.equal(held.busy(), false);

  // A run that never settles and one whose abort fails: neither keeps quitting waiting past the limit.
  const stuckHeld = sends();
  const stuckSettle = new Map<string, () => void>();
  const stuckRun = (session: string) =>
    stuckHeld.hold("agent", session, () => new Promise<SessionResult>((resolve) => stuckSettle.set(session, () => resolve(refusal("aborted")))));
  void stuckRun("stuck");
  const broken = stuckRun("broken");
  const began = Date.now();
  // pi's abort waits for the run to go idle, so the stuck run's abort never returns either.
  const late = await stuckHeld.stopAll((_agentId, session) => {
    if (session === "broken") return Promise.reject(new Error("the agent was removed"));
    return new Promise<SessionResult>(() => {});
  }, 50);
  assert.equal(late, false);
  assert.ok(Date.now() - began < 1000);
  stuckSettle.get("broken")!();
  await broken;
});
