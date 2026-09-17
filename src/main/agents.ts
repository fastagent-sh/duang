/** Local runtime lifetime and the registry are agent-scoped, not tied to the visible conversation. */
import { app } from "electron";
import { join } from "node:path";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { NO_SUCH_SESSION_CODE } from "@fastagent-sh/fastagent/session";
import { authPath } from "./credentials.ts";
import { AgentRegistry, type AgentRow } from "./agent-files.ts";

export { createAgentIn, type AgentRow } from "./agent-files.ts";
const registry = new AgentRegistry(join(app.getPath("userData"), "agents.json"));
export const listAgents = () => registry.list();
export const addAgent = (dir: string) => registry.add(dir);

type Opened = Awaited<ReturnType<typeof createPiAgentFromDir>> & {
  control: NonNullable<Awaited<ReturnType<typeof createPiAgentFromDir>>["sessionControl"]>;
};
const opened = new Map<string, Promise<Opened>>();
const sending = new Map<string, number>();
const changing = new Set<string>();

export class MissingModelError extends Error {}
export class NoAgentError extends Error {}

async function build(row: AgentRow): Promise<Opened> {
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

export function openAgent(row: AgentRow): Promise<Opened> {
  if (changing.has(row.id)) return Promise.reject(new Error("Agent settings are changing; try again."));
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
export async function withAgentRun<T>(row: AgentRow, run: (agent: Opened) => Promise<T>): Promise<T> {
  if (changing.has(row.id)) throw new Error("Agent settings are changing; try again.");
  sending.set(row.id, (sending.get(row.id) ?? 0) + 1);
  try {
    return await run(await openAgent(row));
  } finally {
    const remaining = (sending.get(row.id) ?? 1) - 1;
    if (remaining) sending.set(row.id, remaining);
    else sending.delete(row.id);
  }
}

function beginChange(id: string): void {
  if (changing.has(id)) throw new Error("Agent settings are changing; try again.");
  if (sending.has(id))
    throw new Error("An agent conversation is running — stop it before changing or removing the agent.");
  changing.add(id);
}

/** Prepare the replacement first; failed setup must leave the working runtime and saved choice intact. */
export async function setAgentModel(row: AgentRow, model: string, session?: string): Promise<void> {
  beginChange(row.id);
  try {
    const replacement = await build({ ...row, model });
    if (session) {
      const result = await replacement.control.sessions.get(session).update({ model });
      if (!result.ok && result.error.code !== NO_SUCH_SESSION_CODE) throw new Error(result.error.message);
    }
    await registry.setModel(row.id, model);
    opened.set(row.id, Promise.resolve(replacement));
  } finally {
    changing.delete(row.id);
  }
}

export async function removeAgent(id: string): Promise<void> {
  beginChange(id);
  try {
    await registry.remove(id);
    opened.delete(id);
  } finally {
    changing.delete(id);
  }
}
