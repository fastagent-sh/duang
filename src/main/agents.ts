/** The agent registry: rows on disk, opened assemblies in memory. */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { authPathFor } from "./credentials.ts";
import type { Agent } from "@fastagent-sh/fastagent/core";
import type { SessionControl } from "@fastagent-sh/fastagent/session";

export interface AgentRow {
  id: string;
  name: string;
  dir: string;
  /** duang's model override for this agent. The directory stays the source of truth; we never edit it. */
  model?: string;
}

// ponytail: one JSON file, rewritten whole. A list of agents fits in memory; revisit if it ever doesn't.
const file = () => join(app.getPath("userData"), "agents.json");

let rows: AgentRow[] | undefined;

export async function listAgents(): Promise<AgentRow[]> {
  if (!rows) {
    try {
      rows = JSON.parse(await readFile(file(), "utf8")) as AgentRow[];
    } catch {
      rows = [];
    }
  }
  return rows;
}

export async function addAgent(dir: string): Promise<AgentRow> {
  const all = await listAgents();
  const existing = all.find((a) => a.dir === dir);
  if (existing) return existing;
  const row: AgentRow = { id: randomUUID(), name: basename(dir), dir };
  all.push(row);
  await writeFile(file(), JSON.stringify(all, null, 2));
  return row;
}

/** Removing an agent is removing duang's row. The directory is never touched. */
export async function removeAgent(id: string): Promise<void> {
  const all = await listAgents();
  rows = all.filter((a) => a.id !== id);
  opened.delete(id);
  await writeFile(file(), JSON.stringify(rows, null, 2));
}

export async function setAgentModel(id: string, model: string): Promise<void> {
  const all = await listAgents();
  const row = all.find((a) => a.id === id);
  if (!row) throw new Error(`unknown agent ${id}`);
  row.model = model;
  opened.delete(id);
  await writeFile(file(), JSON.stringify(all, null, 2));
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

/**
 * Give a plain project an agent, in the layout FastAgent expects: the agent lives in a subdirectory,
 * so the project itself stays the workspace the agent works ON. Two files and nothing else — no npm
 * install, no persona, no tools; the coding tools and the project's `AGENTS.md` come for free, and
 * `fastagent init` remains the way to get the full scaffold.
 */
export async function createAgentIn(dir: string): Promise<string> {
  const agentDir = join(dir, "fastagent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "fastagent.config.ts"), "export default {};\n");
  await writeFile(join(agentDir, ".gitignore"), ".state/\n.secrets/\n.env\n");
  return agentDir;
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
