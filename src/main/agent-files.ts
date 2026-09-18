import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AgentRow {
  id: string;
  name: string;
  dir: string;
  model?: string;
}

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
    const rows: unknown = JSON.parse(text);
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !row ||
          typeof row.id !== "string" ||
          typeof row.name !== "string" ||
          typeof row.dir !== "string" ||
          (row.model !== undefined && typeof row.model !== "string"),
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
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(rows, null, 2), { flag: "wx", mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
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
      const row = { id: randomUUID(), name: basename(canonical), dir: canonical };
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

  setModel(id: string, model: string): Promise<void> {
    return this.change((rows) => {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new Error(`unknown agent ${id}`);
      row.model = model;
    });
  }
}

/** Only create a new directory. Never overwrite a project's existing configuration or ignore rules. */
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
