import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeJsonAtomic } from "./json-file.ts";

export interface AgentRow {
  id: string;
  name: string;
  dir: string;
  /** duang's model override for this agent. The directory stays the source of truth; we never edit it. */
  model?: string;
  /**
   * Which colour its avatar wears: the lowest number no other agent had when it was assigned, kept for
   * the agent's life (a rename does not recolour it, and a removed agent's number is reused). The
   * renderer maps it onto its palette, so the registry does not need to know how big that is.
   */
  colour: number;
}

const lowestFree = (rows: AgentRow[]): number => {
  const used = new Set(rows.map((row) => row.colour));
  let colour = 0;
  while (used.has(colour)) colour++;
  return colour;
};

/** The registry is not a cache: a read error must never turn into an empty file on the next write. */
export class AgentRegistry {
  private pending: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(file: string) {
    this.file = file;
  }

  async list(): Promise<AgentRow[]> {
    await this.pending;
    return this.read();
  }

  private async read(): Promise<AgentRow[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch (error) {
      // A bare SyntaxError names a column, not a file. The person has to know what to open.
      throw new Error(`${this.file}: ${(error as Error).message}`, { cause: error });
    }
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !row ||
          typeof row.id !== "string" ||
          typeof row.name !== "string" ||
          typeof row.dir !== "string" ||
          (row.model !== undefined && typeof row.model !== "string") ||
          !(Number.isInteger(row.colour) && row.colour >= 0),
      ) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    ) {
      throw new Error(`${this.file}: invalid agent registry`);
    }
    return rows;
  }

  private change<T>(edit: (rows: AgentRow[]) => T): Promise<T> {
    const operation = this.pending.then(async () => {
      const rows = await this.read();
      const result = edit(rows);
      await writeJsonAtomic(this.file, rows);
      return result;
    });
    // The caller receives the error; subsequent operations still get a chance to retry.
    this.pending = operation.catch(() => {});
    return operation;
  }

  async add(dir: string): Promise<AgentRow> {
    const canonical = await realpath(dir);
    return this.change((rows) => {
      const existing = rows.find((row) => row.dir === canonical);
      if (existing) return existing;
      const row = { id: randomUUID(), name: basename(canonical), dir: canonical, colour: lowestFree(rows) };
      rows.push(row);
      return row;
    });
  }

  remove(id: string): Promise<void> {
    return this.change((rows) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`unknown agent ${id}`);
      rows.splice(index, 1);
    });
  }

  /** The roster's name for this agent. duang's label only: the directory is not renamed. */
  rename(id: string, name: string): Promise<void> {
    return this.change((rows) => {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new Error(`unknown agent ${id}`);
      row.name = name;
    });
  }

  setModel(id: string, model: string): Promise<void> {
    return this.change((rows) => {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new Error(`unknown agent ${id}`);
      row.model = model;
    });
  }
}

/**
 * Give a plain project an agent, in the layout FastAgent expects: the agent lives in a subdirectory,
 * so the project itself stays the workspace the agent works ON. Two files and nothing else — no npm
 * install, no persona, no tools; the coding tools and the project's `AGENTS.md` come for free, and
 * `fastagent init` remains the way to get the full scaffold.
 *
 * Only ever create a new directory: a project's existing configuration or ignore rules are not ours.
 */
export async function createAgentIn(dir: string): Promise<string> {
  const agentDir = join(dir, "fastagent");
  // No `recursive`: an existing directory fails here with EEXIST and is never touched below.
  await mkdir(agentDir);
  try {
    await writeFile(join(agentDir, "fastagent.config.ts"), "export default {};\n", { flag: "wx" });
    await writeFile(join(agentDir, ".gitignore"), ".state/\n.secrets/\n.env\n", { flag: "wx" });
  } catch (error) {
    // This call created the directory, so a half-written one is ours to remove. Leaving it would
    // make every later attempt fail with EEXIST and strand the Create button for good.
    await rm(agentDir, { recursive: true });
    throw error;
  }
  return agentDir;
}
