/**
 * Point Node's `fetch` at the proxy, or every model call fails with a bare "fetch failed".
 *
 * Three facts make this necessary: Node's fetch ignores `HTTPS_PROXY`; Electron's Node reads
 * `NODE_USE_ENV_PROXY` at boot, so setting it from here is too late; and an app launched from Finder
 * has no proxy variables at all. Chromium already resolved the system proxy — this hands that answer
 * to Node by way of undici's global dispatcher, which Node's built-in fetch reads.
 */
import { session } from "electron";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { log } from "./log.ts";

function fromEnv(): string | undefined {
  return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy;
}

async function fromSystem(): Promise<string | undefined> {
  // A PAC-style answer: "PROXY host:port; DIRECT" or "DIRECT". The first entry is the one to use.
  const resolved = await session.defaultSession.resolveProxy("https://api.anthropic.com");
  const proxy = /PROXY\s+([^;]+)/.exec(resolved)?.[1]?.trim();
  return proxy ? `http://${proxy}` : undefined;
}

export async function useSystemProxy(): Promise<void> {
  const url = fromEnv() ?? (await fromSystem());
  if (!url) return log("proxy: direct");
  setGlobalDispatcher(new ProxyAgent(url));
  log(`proxy: ${url}`);
}
