/**
 * duang's own preferences: the network route and the avatar style. Not navigation memory like the window
 * bounds: a manual proxy someone typed must not silently turn into "automatic", so a file that
 * cannot be read or parsed is an error, and only a missing file is a first run.
 */
import { readJson, serially, writeJsonAtomic } from "./json-file.ts";

export type Network = { mode: "automatic" } | { mode: "manual"; url: string } | { mode: "off" };
/** How agents' avatars are drawn (the renderer's `avatar.tsx`); the first is the default. */
export const AVATARS = ["gaze", "moods", "clay", "bottts", "pixelbot", "initialFace", "initials"] as const;
export type AvatarStyle = (typeof AVATARS)[number];
export interface Settings {
  network: Network;
  avatar: AvatarStyle;
}
export const DEFAULTS: Settings = { network: { mode: "automatic" }, avatar: AVATARS[0] };

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

export function avatar(value: unknown): AvatarStyle {
  if (AVATARS.includes(value as AvatarStyle)) return value as AvatarStyle;
  throw new Error(`Unknown avatar style: ${JSON.stringify(value)}`);
}

function settings(value: unknown): Settings {
  const parsed = value as { network?: unknown; avatar?: unknown };
  // A setting the file does not name was never chosen: it is the default, not an error.
  return {
    network: parsed.network === undefined ? DEFAULTS.network : network(parsed.network),
    avatar: parsed.avatar === undefined ? DEFAULTS.avatar : avatar(parsed.avatar),
  };
}

/** The settings file, and the one queue every change to it goes through. */
export class SettingsFile {
  private queue = serially();
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  /** The file as it is now, without waiting for a change in progress (and the route it applies). */
  read(): Promise<Settings> {
    return readJson(this.path, DEFAULTS, settings);
  }

  /**
   * One change at a time, read, merged and written whole: the network and the avatar rewrite the same file,
   * and neither may lose the other's change. A file that cannot be read is not overwritten, since it may
   * hold what the person meant. `then` runs in the same turn of the queue, so what it applies is what was
   * written: two quick network choices end with the file, Chromium and the answer all on the second.
   */
  change<T>(patch: Partial<Settings>, then?: () => Promise<T>): Promise<T | undefined> {
    return this.queue.run(async () => {
      await writeJsonAtomic(this.path, { ...(await this.read()), ...patch });
      return then?.();
    });
  }
}
