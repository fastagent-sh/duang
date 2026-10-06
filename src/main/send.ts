import { ABORTED_CODE, SESSION_BUSY_CODE, type Agent } from "@fastagent-sh/fastagent/core";
import { NO_ACTIVE_RUN_CODE, type Session, type SessionResult } from "@fastagent-sh/fastagent/session";

// A thrown refusal would reach the renderer wrapped in Electron's `Error invoking remote method`.
export const refuse = (code: string, message: string): SessionResult => ({
  ok: false,
  error: { code, message, retryable: true },
});

const stoppedBeforeStart = refuse(ABORTED_CODE, "Stopped before the run started");

export const MODEL_UNAVAILABLE_CODE = "model_unavailable";
const unavailable = (model: string) =>
  refuse(
    MODEL_UNAVAILABLE_CODE,
    `${model} cannot run: its provider is not connected, or the model is not offered to it. Connect the provider, or choose another model for this conversation.`,
  );

// `stopped` is checked right before each hand-off, so a Stop that came first makes no call. A run starts only
// on a model the picker would offer; anything else is refused before anything is recorded.
export async function send(
  agent: Agent,
  session: Session,
  text: string,
  stopped: () => boolean,
  offered: (model: string) => Promise<boolean>,
): Promise<SessionResult> {
  const state = await session.state();
  if (state.status === "running") {
    if (stopped()) return stoppedBeforeStart;
    const result = await session.steer({ text });
    if (result.ok || result.error.code !== NO_ACTIVE_RUN_CODE) return result;
  }
  if (state.model && !(await offered(state.model))) return unavailable(state.model);
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

// Before a send reaches the runtime there is no run to abort, so a Stop is recorded here and the send gives up.
export function sends() {
  type Ticket = { stopped: boolean; finished: Promise<unknown> };
  const held = new Map<string, Set<Ticket>>();
  let quitting = false;
  const stop = async (key: string, abort: () => Promise<SessionResult>): Promise<SessionResult> => {
    const tickets = held.get(key);
    for (const ticket of tickets ?? []) ticket.stopped = true;
    const result = await abort();
    return !result.ok && result.error.code === NO_ACTIVE_RUN_CODE && tickets?.size ? { ok: true } : result;
  };
  return {
    hold(key: string, run: (stopped: () => boolean) => Promise<SessionResult>): Promise<SessionResult> {
      if (quitting) return Promise.resolve(refuse("quitting", "duang is quitting: the message was not sent"));
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
    busy: () => held.size > 0,
    // The limit starts before the aborts: pi's abort waits for its run to go idle, so it can take as long as the run.
    async stopAll(abort: (key: string) => Promise<SessionResult>, within: number): Promise<boolean> {
      // The window stays open while this waits: a message sent meanwhile is refused, not started and cut.
      quitting = true;
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
    stop,
  };
}
