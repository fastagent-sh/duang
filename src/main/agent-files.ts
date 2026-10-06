import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { readJson, serially, writeJsonAtomic } from "./json-file.ts";

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

function registryRows(rows: unknown): AgentRow[] {
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
  )
    throw new Error("invalid agent registry");
  return rows;
}

/** The registry is not a cache: a read error must never turn into an empty file on the next write. */
export class AgentRegistry {
  private queue = serially();
  private file: string;
  constructor(file: string) {
    this.file = file;
  }

  /** After the changes already asked for: a row just added is listed. */
  async list(): Promise<AgentRow[]> {
    await this.queue.idle();
    return this.read();
  }

  private read(): Promise<AgentRow[]> {
    return readJson(this.file, [], registryRows);
  }

  private change<T>(edit: (rows: AgentRow[]) => T): Promise<T> {
    return this.queue.run(async () => {
      const rows = await this.read();
      const result = edit(rows);
      await writeJsonAtomic(this.file, rows);
      return result;
    });
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

  /**
   * The agent's folder was moved: the same agent (its id, name and colour) is found at `dir` now. Its
   * conversations are in the folder, so they come with it. A folder another agent already is, is refused.
   */
  async relocate(id: string, dir: string): Promise<void> {
    const canonical = await realpath(dir);
    return this.change((rows) => {
      const row = rows.find((row) => row.id === id);
      if (!row) throw new Error(`unknown agent ${id}`);
      const other = rows.find((other) => other.dir === canonical && other.id !== id);
      if (other) throw new Error(`${canonical} is already the agent "${other.name}"`);
      row.dir = canonical;
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

/** FastAgent's one config filename, and what a new one says: nothing, so the agent asks for a model. */
const CONFIG_FILE = "fastagent.config.ts";
const FRESH_CONFIG = "export default {};\n";

/** The registered folder is not there (moved, deleted, a drive not mounted): nothing to scaffold into. */
export class MissingDirError extends Error {}

/**
 * Only a folder that is not there is missing. Any other reason it cannot be looked at (no permission, macOS
 * privacy controls) is its own failure, said in its own words, and not a folder to go and locate.
 */
export async function requireFolder(dir: string): Promise<void> {
  try {
    await stat(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new MissingDirError((error as Error).message);
    throw error;
  }
}

/**
 * Whether a load failed because pi does not know `model`, duang's default for the agent (an endpoint removed from a
 * `models.json`, a model retired from pi's catalog), as FastAgent words it. Not a model in the agent's own config:
 * that one is the config's to fix.
 */
export function unknownDefault(message: string, model: string | undefined): boolean {
  return model !== undefined && message.includes(`unknown model "${model}"`);
}

/**
 * The config a load failed in, as FastAgent's loader names it: every failure of `loadConfig` (a syntax error,
 * a file it imports, a bad key) starts with the config's own path. Undefined for any other failure.
 */
export function failingConfig(message: string): string | undefined {
  return message.match(/^(\/[^\n]*\/fastagent\.config\.ts): /)?.[1];
}

/**
 * Start a fresh config in place of one that does not load, given as FastAgent named it: only a config inside
 * the agent's folder (a symlink out of it does not count). The old one is copied beside it first, to a name
 * nothing loads (`fastagent.config.ts.broken-20261003-144000`), and never over an earlier copy.
 */
export async function freshConfig(dir: string, config: string, now = new Date()): Promise<void> {
  const [root, real] = await Promise.all([realpath(dir), realpath(config)]);
  if (!real.startsWith(`${root}${sep}`) || basename(real) !== CONFIG_FILE) throw new Error(`${config} is not this agent's ${CONFIG_FILE}`);
  // In the person's own time: they read this name.
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  // EXCL: a second reset in the same second fails here rather than replacing the person's file with the fresh one.
  await copyFile(real, `${real}.broken-${stamp}`, constants.COPYFILE_EXCL);
  await writeFile(real, FRESH_CONFIG);
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
    await writeFile(join(agentDir, CONFIG_FILE), FRESH_CONFIG, { flag: "wx" });
    await writeFile(join(agentDir, ".gitignore"), ".state/\n.secrets/\n.env\n", { flag: "wx" });
  } catch (error) {
    // This call created the directory, so a half-written one is ours to remove. Leaving it would
    // make every later attempt fail with EEXIST and strand the Create button for good.
    await rm(agentDir, { recursive: true });
    throw error;
  }
  return agentDir;
}
