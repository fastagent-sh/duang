import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * How duang reads its own files (the agent registry, the settings): only a missing file is `missing`, a first
 * run. Anything else that stops it being read, parsed or accepted by `parse` is an error that names the file,
 * because the person has to know which file to open, not which column of it.
 */
export async function readJson<T>(file: string, missing: T, parse: (value: unknown) => T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing;
    throw error;
  }
  try {
    return parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * How duang writes its own files: whole or not at all, through a temporary file renamed over the old one, so a
 * crash or a full disk never leaves half a file. Only this user can read them.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Changes to one file, one at a time, each after every earlier one has ended however it ended: the caller gets
 * its own failure, and the next change still runs. `idle` settles once everything queued so far has.
 */
export function serially() {
  let pending: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const run = pending.then(work);
      pending = run.catch(() => {});
      return run;
    },
    idle: () => pending,
  };
}
