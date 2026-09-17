/** The agent registry: rows on disk, opened assemblies in memory. */
import { app } from "electron";
import { join } from "node:path";
import { AgentRegistry, type AgentRow } from "./agent-files.ts";
export { createAgentIn, type AgentRow } from "./agent-files.ts";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { authPathFor } from "./credentials.ts";
import type { Agent } from "@fastagent-sh/fastagent/core";
import type { SessionControl } from "@fastagent-sh/fastagent/session";

const registry = new AgentRegistry(join(app.getPath("userData"), "agents.json"));
export const listAgents = () => registry.list();
export const addAgent = (dir: string) => registry.add(dir);

/** Removing an agent is removing duang's row. The directory is never touched. */
export async function removeAgent(id: string): Promise<void> {
  await registry.remove(id);
  opened.delete(id);
}

export async function setAgentModel(id: string, model: string): Promise<void> {
  await registry.setModel(id, model);
  opened.delete(id);
}

interface Opened {
  agent: Agent;
  control: SessionControl;
}

/** What the UI must act on differently, as opposed to merely report. */
export class MissingModelError extends Error {
  readonly code = "missing_model";
}

/** The directory is fine, it just holds no agent yet — a question for the user, not a failure. */
export class NoAgentError extends Error {
  readonly code = "no_agent";
}

const opened = new Map<string, Promise<Opened>>();

/**
 * The local half of the endpoint switch: one directory becomes an `Agent` (runs turns) plus a
 * `SessionControl` (observes and steers them), both in this process. The cloud half is the same
 * `SessionControl` over HTTP, and nothing above this function knows which it got.
 */
export function openAgent(row: AgentRow): Promise<Opened> {
  const cached = opened.get(row.id);
  if (cached) return cached;
  const promise = authPathFor(row.model)
    .then((authPath) =>
      createPiAgentFromDir(row.dir, {
        serving: true,
        sessionControl: true,
        ...(row.model ? { model: row.model } : {}),
        ...(authPath ? { authPath } : {}),
      }),
    )
    .then(
    (a) => {
      if (!a.sessionControl) throw new Error(`${row.dir}: no session control (config.sessionControl is off)`);
      return { agent: a.agent, control: a.sessionControl };
    },
    (error: unknown) => {
      // A scaffolded agent has no model until someone picks one; that is a question for the user,
      // not a failure to report. FastAgent says so in prose, so this is the one place that reads it.
      const message = error instanceof Error ? error.message : String(error);
      // FastAgent says both of these in prose, so this is the one place that reads them.
      if (/missing model/i.test(message)) throw new MissingModelError(message);
      if (/is not a fastagent agent/i.test(message)) throw new NoAgentError(message);
      throw error;
    },
  );
  // A failed open must not poison the entry: the user fixes the directory and tries again.
  promise.catch(() => opened.delete(row.id));
  opened.set(row.id, promise);
  return promise;
}
