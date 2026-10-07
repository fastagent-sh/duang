import { app } from "electron";
import { join } from "node:path";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { NO_SUCH_SESSION_CODE, type SessionResult } from "@fastagent-sh/fastagent/session";
import { authPath } from "./models.ts";
import { refuse } from "./send.ts";
import {
  AgentRegistry,
  failingConfig,
  freshConfig,
  MissingDirError,
  requireFolder,
  unknownDefault,
  type AgentRow,
} from "./agent-files.ts";

export { createAgentIn, MissingDirError, type AgentRow } from "./agent-files.ts";
export const registryFile = join(app.getPath("userData"), "agents.json");
const registry = new AgentRegistry(registryFile);
export const listAgents = () => registry.list();
export const addAgent = (dir: string) => registry.add(dir);
export const renameAgent = (id: string, name: string) => registry.rename(id, name);

type Opened = Awaited<ReturnType<typeof createPiAgentFromDir>> & {
  control: NonNullable<Awaited<ReturnType<typeof createPiAgentFromDir>>["sessionControl"]>;
  staleDefault?: string;
};
// Agent-scoped admission: sends share (a count); a model change or removal excludes them all, including turns
// still opening. FastAgent's per-session `inProcessLease` cannot express that.
const opened = new Map<string, Promise<Opened>>();
const sending = new Map<string, number>();
const changing = new Map<string, Promise<void>>();

export class NoAgentError extends Error {}
// Main keeps the failing path rather than taking one from the window.
const failedConfigs = new Map<string, string>();

// A default on a retired provider still opens: the first send is refused as `model_unavailable`.
async function build(row: AgentRow): Promise<Opened> {
  // Before anything can fail: a failure that is not the config's must not offer to replace it.
  // A missing folder must fail here: FastAgent calls it "not a fastagent agent", which offers a scaffold.
  failedConfigs.delete(row.id);
  await requireFolder(row.dir);
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
    // FastAgent exposes this setup condition as prose, not an error code.
    if (/is not a fastagent agent/i.test(message)) throw new NoAgentError(message);
    const config = failingConfig(message);
    if (config) failedConfigs.set(row.id, config);
    throw error;
  }
}

// Opening only: an unknown default is dropped and reported as `staleDefault`; a model change refuses it.
async function buildToOpen(row: AgentRow): Promise<Opened> {
  try {
    return await build(row);
  } catch (error) {
    if (!unknownDefault(error instanceof Error ? error.message : String(error), row.model)) throw error;
    return { ...(await build({ ...row, model: undefined })), staleDefault: row.model };
  }
}

export async function openAgent(row: AgentRow): Promise<Opened> {
  // Wait rather than fail: "try again" is not actionable. The admitting read is stale after the change.
  while (changing.has(row.id)) {
    await changing.get(row.id);
    if (!(await registry.list()).some((a) => a.id === row.id)) throw new Error(`unknown agent ${row.id}`);
  }
  const cached = opened.get(row.id);
  if (cached) return cached;
  const promise = buildToOpen(row);
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

export function relocateAgent(id: string, dir: string): Promise<SessionResult> {
  return change(id, async () => {
    await registry.relocate(id, dir);
    failedConfigs.delete(id);
    opened.delete(id);
    return { ok: true };
  });
}

export const configFailed = (id: string) => failedConfigs.has(id);

export function resetAgentConfig(row: AgentRow): Promise<SessionResult> {
  return change(row.id, async () => {
    const config = failedConfigs.get(row.id);
    if (!config) return refuse("config_loads", "This agent's config is not what failed to load. Retry to see what did.");
    await freshConfig(row.dir, config);
    failedConfigs.delete(row.id);
    opened.delete(row.id);
    return { ok: true };
  });
}

export function removeAgent(id: string): Promise<SessionResult> {
  return change(id, async () => {
    await registry.remove(id);
    failedConfigs.delete(id);
    opened.delete(id);
    return { ok: true };
  });
}
