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
  type Ticket = { stopped: boolean; finished: Promise<unknown> };
  const held = new Map<string, Set<Ticket>>();
  const stop = async (key: string, abort: () => Promise<SessionResult>): Promise<SessionResult> => {
    const tickets = held.get(key);
    for (const ticket of tickets ?? []) ticket.stopped = true;
    const result = await abort();
    return !result.ok && result.error.code === NO_ACTIVE_RUN_CODE && tickets?.size ? { ok: true } : result;
  };
  return {
    hold<T>(key: string, run: (stopped: () => boolean) => Promise<T>): Promise<T> {
      const ticket: Ticket = { stopped: false, finished: Promise.resolve() };
      const tickets = held.get(key) ?? new Set();
      held.set(key, tickets.add(ticket));
      const finished = run(() => ticket.stopped).finally(() => {
        tickets.delete(ticket);
        if (tickets.size === 0 && held.get(key) === tickets) held.delete(key);
      });
      ticket.finished = finished.catch(() => {});
      return finished;
    },
    /** Whether any send is in main's hands: a turn that quitting would cut. */
    busy: () => held.size > 0,
    /**
     * Quitting: every conversation with a send in flight is stopped as Stop would, and this waits for those
     * sends to return, which is when each run has settled and written how it ended, or until `within` ms pass
     * (a tool that cannot be cancelled may hold its run). Says whether all of them returned in time.
     *
     * The limit starts before the aborts and does not wait for them: pi's abort itself waits for its run to
     * go idle, so an abort can take as long as the run it stops.
     */
    async stopAll(abort: (key: string) => Promise<SessionResult>, within: number): Promise<boolean> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), within)));
      const finished = [...held.values()].flatMap((tickets) => [...tickets].map((ticket) => ticket.finished));
      // A conversation that cannot be stopped must not keep the app from quitting; it is said, not hidden.
      for (const key of held.keys())
        stop(key, () => abort(key)).then(
          (result) => {
            if (!result.ok) console.error(`duang: ${key} could not be stopped before quitting:`, result.error.message);
          },
          (error: unknown) => console.error(`duang: ${key} could not be stopped before quitting:`, error),
        );
      const done = await Promise.race([Promise.all(finished).then(() => true), timeout]);
      clearTimeout(timer);
      return done;
    },
    /**
     * Stop for one conversation: every send of `key` still held is marked first, then the run is aborted. No
     * run yet, with a send on its way to start one, is a stop that worked: that send now gives up.
     */
    stop,
  };
}
