import { ABORTED_CODE, SESSION_BUSY_CODE, type Agent } from "@fastagent-sh/fastagent/core";
import { NO_ACTIVE_RUN_CODE, type Session, type SessionResult } from "@fastagent-sh/fastagent/session";
import { retired } from "./providers.ts";

const stoppedBeforeStart: SessionResult = {
  ok: false,
  error: { code: ABORTED_CODE, message: "Stopped before the run started", retryable: true },
};

/**
 * The runtime, not a stale UI snapshot, decides whether this message starts or steers a turn. `stopped` is
 * asked right before each call that hands the message to the runtime: a Stop that came first means none is made.
 */
export async function send(agent: Agent, session: Session, text: string, stopped = () => false): Promise<SessionResult> {
  const state = await session.state();
  // A conversation recorded on a provider duang no longer runs does not go on there quietly.
  if (state.model && retired(state.model))
    return {
      ok: false,
      error: { code: "model_retired", message: `${state.model} is no longer offered: pick another model for this conversation`, retryable: false },
    };
  if (state.status === "running") {
    if (stopped()) return stoppedBeforeStart;
    const result = await session.steer({ text });
    if (result.ok || result.error.code !== NO_ACTIVE_RUN_CODE) return result;
  }
  if (stopped()) return stoppedBeforeStart;
  let first = true;
  for await (const event of agent.invoke({ session: session.id }, { text })) {
    if (first && event.type === "failed" && event.code === SESSION_BUSY_CODE) {
      return stopped() ? stoppedBeforeStart : session.steer({ text });
    }
    first = false;
    if (event.type === "failed") {
      return {
        ok: false,
        error: { code: event.code ?? "run_failed", message: event.details, retryable: event.retryable },
      };
    }
  }
  return { ok: true };
}

/**
 * The sends of each conversation, from the moment main receives one until it returns. Before a send reaches
 * the runtime (the proxy is resolved and the agent opened first) there is no run for a Stop to abort, so the
 * Stop is recorded here and the send gives up instead of starting a run nobody wants.
 */
export function sends() {
  const held = new Map<string, Set<{ stopped: boolean }>>();
  return {
    async hold<T>(key: string, run: (stopped: () => boolean) => Promise<T>): Promise<T> {
      const ticket = { stopped: false };
      const tickets = held.get(key) ?? new Set();
      held.set(key, tickets.add(ticket));
      try {
        return await run(() => ticket.stopped);
      } finally {
        tickets.delete(ticket);
        if (tickets.size === 0 && held.get(key) === tickets) held.delete(key);
      }
    },
    /**
     * Stop for one conversation: every send of `key` still held is marked first, then the run is aborted. No
     * run yet, with a send on its way to start one, is a stop that worked: that send now gives up.
     */
    async stop(key: string, abort: () => Promise<SessionResult>): Promise<SessionResult> {
      const tickets = held.get(key);
      for (const ticket of tickets ?? []) ticket.stopped = true;
      const result = await abort();
      return !result.ok && result.error.code === NO_ACTIVE_RUN_CODE && tickets?.size ? { ok: true } : result;
    },
  };
}
