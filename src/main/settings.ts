// Unlike window bounds, an unreadable file is an error: a typed manual proxy must not turn into automatic.
import { readJson, serially, writeJsonAtomic } from "./json-file.ts";

export type Network = { mode: "automatic" } | { mode: "manual"; url: string } | { mode: "off" };
export const AVATARS = ["gaze", "moods", "clay", "bottts", "pixelbot", "initialFace", "initials"] as const;
export type AvatarStyle = (typeof AVATARS)[number];
export interface Settings {
  network: Network;
  avatar: AvatarStyle;
}
export const DEFAULTS: Settings = { network: { mode: "automatic" }, avatar: AVATARS[0] };

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "socks5:": "1080" };

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
  return {
    network: parsed.network === undefined ? DEFAULTS.network : network(parsed.network),
    avatar: parsed.avatar === undefined ? DEFAULTS.avatar : avatar(parsed.avatar),
  };
}

export class SettingsFile {
  private queue = serially();
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }

  read(): Promise<Settings> {
    return readJson(this.path, DEFAULTS, settings);
  }

  // Read, merged and written whole in one queue turn: network and avatar share the file, and `then` applies
  // what was written.
  change<T>(patch: Partial<Settings>, then?: () => Promise<T>): Promise<T | undefined> {
    return this.queue.run(async () => {
      await writeJsonAtomic(this.path, { ...(await this.read()), ...patch });
      return then?.();
    });
  }
}
