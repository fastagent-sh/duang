/** Local runtime lifetime and the registry are agent-scoped, not tied to the visible conversation. */
import { app } from "electron";
import { join } from "node:path";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { NO_SUCH_SESSION_CODE, type SessionResult } from "@fastagent-sh/fastagent/session";
import { authPath } from "./credentials.ts";
import { retired } from "./providers.ts";
import { AgentRegistry, type AgentRow } from "./agent-files.ts";

export { createAgentIn, type AgentRow } from "./agent-files.ts";
/** Exported so a person whose registry cannot be parsed can be shown where it is. */
export const registryFile = join(app.getPath("userData"), "agents.json");
const registry = new AgentRegistry(registryFile);
export const listAgents = () => registry.list();
export const addAgent = (dir: string) => registry.add(dir);
export const renameAgent = (id: string, name: string) => registry.rename(id, name);

type Opened = Awaited<ReturnType<typeof createPiAgentFromDir>> & {
  control: NonNullable<Awaited<ReturnType<typeof createPiAgentFromDir>>["sessionControl"]>;
};
/**
 * Admission is agent-scoped and asymmetric, which is why FastAgent's `inProcessLease` cannot serve
 * it: that lease is a single-writer floor per SESSION (`tryAcquire` returns null while anyone holds
 * it), and it already guards session writes one layer down. Here several conversations of one agent
 * may send at once — hence a count, not a flag — while a model change or removal must exclude all of
 * them, including turns still opening their runtime. Shared-vs-exclusive is not what a `Set<string>`
 * of busy sessions can express.
 *
 * The exclusion is asymmetric in one more way: a send is refused while settings change, because
 * running it would use a model the person never saw, but a READ has nothing to revisit — it waits
 * and gets the runtime that replaced the old one.
 */
const opened = new Map<string, Promise<Opened>>();
const sending = new Map<string, number>();
const changing = new Map<string, Promise<void>>();

export class MissingModelError extends Error {}
export class NoAgentError extends Error {}

async function build(row: AgentRow): Promise<Opened> {
  const opened = await assemble(row);
  // A default on a provider duang no longer runs is no default: the agent asks for a model, as one without any does.
  if (retired(opened.modelSpec)) throw new MissingModelError(`${opened.modelSpec} is no longer offered: pick a model`);
  return opened;
}

async function assemble(row: AgentRow): Promise<Opened> {
  try {
    const assembly = await createPiAgentFromDir(row.dir, {
      sessionControl: true,
      authPath,
      ...(row.model ? { model: row.model } : {}),
    });
    if (!assembly.sessionControl) throw new Error(`${row.dir}: no session control`);
    return { ...assembly, control: assembly.sessionControl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // FastAgent currently exposes these setup conditions as prose, not error codes.
    if (/missing model/i.test(message)) throw new MissingModelError(message);
    if (/is not a fastagent agent/i.test(message)) throw new NoAgentError(message);
    throw error;
  }
}

export async function openAgent(row: AgentRow): Promise<Opened> {
  // Waiting, not failing: "try again" is not a choice the person can act on, and it reached the
  // renderer as an unclassified error, which paints a working agent as broken. The registry read
  // that admitted this call is stale once the change lands, so re-check what it checked.
  while (changing.has(row.id)) {
    await changing.get(row.id);
    if (!(await registry.list()).some((a) => a.id === row.id)) throw new Error(`unknown agent ${row.id}`);
  }
  const cached = opened.get(row.id);
  if (cached) return cached;
  const promise = build(row);
  opened.set(row.id, promise);
  void promise.catch(() => {
    if (opened.get(row.id) === promise) opened.delete(row.id);
  });
  return promise;
}

/** Count admission as busy too: model changes must not race a turn that is still opening its runtime. */
export async function withAgentRun(
  row: AgentRow,
  run: (agent: Opened) => Promise<SessionResult>,
): Promise<SessionResult> {
  if (changing.has(row.id)) return refuse("agent_changing", "Agent settings are changing; try again.");
  sending.set(row.id, (sending.get(row.id) ?? 0) + 1);
  try {
    return await run(await openAgent(row));
  } finally {
    const remaining = (sending.get(row.id) ?? 1) - 1;
    if (remaining) sending.set(row.id, remaining);
    else sending.delete(row.id);
  }
}

/**
 * An expected refusal is an answer, not an exception: the person can act on it, and a thrown one
 * would reach the renderer wrapped in Electron's `Error invoking remote method` prose.
 */
export const refuse = (code: string, message: string): SessionResult => ({
  ok: false,
  error: { code, message, retryable: true },
});

/** One agent's settings change, excluded against its own sends and announced to its own readers. */
function change(id: string, apply: () => Promise<SessionResult>): Promise<SessionResult> {
  if (changing.has(id)) return Promise.resolve(refuse("agent_changing", "Agent settings are changing; try again."));
  if (sending.has(id))
    return Promise.resolve(
      refuse("agent_busy", "An agent conversation is running — stop it before changing or removing the agent."),
    );
  // Nothing can interleave between starting the work and publishing it: `apply` cannot reach another
  // admission before its first await, and this runs in the same synchronous block.
  const running = apply();
  changing.set(
    id,
    running.then(
      () => {},
      () => {},
    ),
  );
  return running.finally(() => changing.delete(id));
}

/** Prepare the replacement first; failed setup must leave the working runtime and saved choice intact. */
export function setAgentModel(row: AgentRow, model: string, session?: string): Promise<SessionResult> {
  return change(row.id, async () => {
    const replacement = await build({ ...row, model });
    if (session) {
      const result = await replacement.control.sessions.get(session).update({ model });
      if (!result.ok && result.error.code !== NO_SUCH_SESSION_CODE) throw new Error(result.error.message);
    }
    await registry.setModel(row.id, model);
    opened.set(row.id, Promise.resolve(replacement));
    return { ok: true };
  });
}

export function removeAgent(id: string): Promise<SessionResult> {
  return change(id, async () => {
    await registry.remove(id);
    opened.delete(id);
    return { ok: true };
  });
}
