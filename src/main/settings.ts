/**
 * duang's own preferences — today only the network route. Not navigation memory like the window
 * bounds: a manual proxy someone typed must not silently turn into "automatic", so a file that
 * cannot be read or parsed is an error, and only a missing file is a first run.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Network = { mode: "automatic" } | { mode: "manual"; url: string } | { mode: "off" };
export interface Settings {
  network: Network;
}
export const DEFAULTS: Settings = { network: { mode: "automatic" } };

/** The port a scheme implies, written out so a saved proxy always names its port. */
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "socks5:": "1080" };

/** A proxy URL Chromium and undici both accept: http, https or socks5, with a host. */
export function proxyUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A manual proxy needs a URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Not a URL: ${value}`);
  }
  if (!(url.protocol in DEFAULT_PORTS) || !url.hostname)
    throw new Error(`A proxy URL is http://, https:// or socks5:// with a host: ${value}`);
  // `url.host` drops a port equal to the scheme's default, and the page reads the port back from
  // what was saved; an empty Port field would then refuse the next save.
  return `${url.protocol}//${url.hostname}:${url.port || DEFAULT_PORTS[url.protocol]}`;
}

export function network(value: unknown): Network {
  const mode = (value as { mode?: unknown } | null)?.mode;
  if (mode === "automatic" || mode === "off") return { mode };
  if (mode === "manual") return { mode, url: proxyUrl((value as { url?: unknown }).url) };
  throw new Error(`Unknown network mode: ${JSON.stringify(mode)}`);
}

export async function readSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULTS;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as { network?: unknown };
    return { network: parsed.network === undefined ? DEFAULTS.network : network(parsed.network) };
  } catch (error) {
    // The person has to know which file to open, not which column of it.
    throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
  }
}

/** Whole file or none of it, the same way the agent registry is written. */
export async function writeSettings(file: string, settings: Settings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
