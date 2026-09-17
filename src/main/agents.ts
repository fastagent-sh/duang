/** The agent registry: rows on disk, opened assemblies in memory. */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import type { Agent } from "@fastagent-sh/fastagent/core";
import type { SessionControl } from "@fastagent-sh/fastagent/session";

export interface AgentRow {
  id: string;
  name: string;
  dir: string;
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

interface Opened {
  agent: Agent;
  control: SessionControl;
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
  const promise = createPiAgentFromDir(row.dir, { serving: true, sessionControl: true }).then((a) => {
    if (!a.sessionControl) throw new Error(`${row.dir}: no session control (config.sessionControl is off)`);
    return { agent: a.agent, control: a.sessionControl };
  });
  // A failed open must not poison the entry: the user fixes the directory and tries again.
  promise.catch(() => opened.delete(row.id));
  opened.set(row.id, promise);
  return promise;
}
