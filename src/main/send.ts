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
  type Held = { agentId: string; session: string; tickets: Set<Ticket> };
  const held = new Map<string, Held>();
  const keyOf = (agentId: string, session: string) => `${agentId}/${session}`;
  let quitting = false;
  const stop = async (agentId: string, session: string, abort: () => Promise<SessionResult>): Promise<SessionResult> => {
    const tickets = held.get(keyOf(agentId, session))?.tickets;
    for (const ticket of tickets ?? []) ticket.stopped = true;
    const result = await abort();
    return !result.ok && result.error.code === NO_ACTIVE_RUN_CODE && tickets?.size ? { ok: true } : result;
  };
  return {
    hold(agentId: string, session: string, run: (stopped: () => boolean) => Promise<SessionResult>): Promise<SessionResult> {
      if (quitting) return Promise.resolve(refuse("quitting", "duang is quitting: the message was not sent"));
      const key = keyOf(agentId, session);
      const ticket: Ticket = { stopped: false, finished: Promise.resolve() };
      const entry = held.get(key) ?? { agentId, session, tickets: new Set() };
      held.set(key, entry);
      entry.tickets.add(ticket);
      const finished = run(() => ticket.stopped).finally(() => {
        entry.tickets.delete(ticket);
        if (entry.tickets.size === 0 && held.get(key) === entry) held.delete(key);
      });
      ticket.finished = finished.catch(() => {});
      return finished;
    },
    busy: () => held.size > 0,
    // The limit starts before the aborts: pi's abort waits for its run to go idle, so it can take as long as the run.
    async stopAll(abort: (agentId: string, session: string) => Promise<SessionResult>, within: number): Promise<boolean> {
      // The window stays open while this waits: a message sent meanwhile is refused, not started and cut.
      quitting = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), within)));
      const finished = [...held.values()].flatMap(({ tickets }) => [...tickets].map((ticket) => ticket.finished));
      // A conversation that cannot be stopped must not keep the app from quitting; it is said, not hidden.
      for (const { agentId, session } of held.values()) {
        const failed = (reason: unknown) =>
          console.error(`duang: ${keyOf(agentId, session)} could not be stopped before quitting:`, reason);
        stop(agentId, session, () => abort(agentId, session)).then((result) => {
          if (!result.ok) failed(result.error.message);
        }, failed);
      }
      const done = await Promise.race([Promise.all(finished).then(() => true), timeout]);
      clearTimeout(timer);
      return done;
    },
    stop,
  };
}
