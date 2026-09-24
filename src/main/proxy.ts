/**
 * One network route for everything main sends — model calls, sign-in token exchanges, plan usage —
 * owned by Chromium's proxy configuration.
 *
 * Node's `fetch` ignores the system proxy, and a proxy read once at startup misses a VPN client
 * switched on later, PAC rules and the system bypass list. So the global dispatcher asks
 * `session.resolveProxy` for every request (route.ts), and the Network setting only changes what
 * Chromium is configured with: the system's settings, a fixed proxy, or none.
 */
import { session } from "electron";
import { setGlobalDispatcher } from "undici";
import { commandProxyEnv, routeOf, RoutedDispatcher } from "./route.ts";
import type { Network } from "./settings.ts";

/** Model traffic is what the route display is about. */
const MODEL_HOST = "https://api.anthropic.com";
/** Agent commands mostly fetch code and packages; this is the host their one proxy is chosen for. */
const COMMAND_HOST = "https://github.com";
const TEST_TIMEOUT_MS = 10_000;

/**
 * Proxy variables present when duang was launched from a terminal: an explicit route someone
 * exported, so Automatic uses it (and cannot follow system changes until a relaunch), and duang never
 * rewrites those variables for agent commands.
 */
const LAUNCH_VARIABLES = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
const launchVariable = LAUNCH_VARIABLES.find((name) => process.env[name]);
const launchUrl = launchVariable ? process.env[launchVariable] : undefined;
const presentAtLaunch = new Set(Object.keys(process.env));

export type Source = "system" | "environment" | "manual" | "off";
export interface Route {
  /** The proxy model requests use now, or undefined for a direct connection. */
  proxy?: string;
  source: Source;
  /** The launch variable Automatic is using, when it is. */
  variable?: string;
}

let current: Network = { mode: "automatic" };
let installed = false;

export async function applyNetwork(network: Network): Promise<void> {
  const config: Electron.ProxyConfig =
    network.mode === "off"
      ? { mode: "direct" }
      : network.mode === "manual"
        ? { mode: "fixed_servers", proxyRules: network.url }
        : launchUrl
          ? {
              mode: "fixed_servers",
              proxyRules: launchUrl,
              proxyBypassRules: process.env.NO_PROXY ?? process.env.no_proxy ?? "",
            }
          : { mode: "system" };
  await session.defaultSession.setProxy(config);
  // Connections Chromium already holds would keep an old proxy; the next request must use the new one.
  await session.defaultSession.closeAllConnections();
  current = network;
  if (!installed) {
    setGlobalDispatcher(new RoutedDispatcher((origin) => session.defaultSession.resolveProxy(origin)));
    installed = true;
  }
  await syncCommandProxy();
}

export async function describeRoute(): Promise<Route> {
  const proxy = routeOf(await session.defaultSession.resolveProxy(MODEL_HOST));
  const source: Source = current.mode === "automatic" ? (launchUrl ? "environment" : "system") : current.mode === "manual" ? "manual" : "off";
  return { ...(proxy ? { proxy } : {}), source, ...(source === "environment" ? { variable: launchVariable } : {}) };
}

/**
 * Agent tools spawn with a copy of main's environment taken at each spawn, so this is re-run before
 * every send. Variables the launch environment had are the person's and are left alone.
 */
export async function syncCommandProxy(): Promise<void> {
  if (launchUrl) return;
  const proxy = routeOf(await session.defaultSession.resolveProxy(COMMAND_HOST));
  for (const [name, value] of Object.entries(commandProxyEnv(proxy))) {
    if (presentAtLaunch.has(name)) continue;
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** One request over the same route a model call takes. Any HTTP answer means the network works. */
export async function testConnection(): Promise<{ status: number; route: Route }> {
  const route = await describeRoute();
  try {
    const response = await fetch(MODEL_HOST, { method: "HEAD", signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    return { status: response.status, route };
  } catch (error) {
    // `fetch failed` alone says nothing; the cause and the route are what a person can act on.
    const cause = (error as Error & { cause?: Error & { code?: string } }).cause;
    const why = cause ? `${cause.code ? `${cause.code}: ` : ""}${cause.message}` : (error as Error).message;
    throw new Error(`${new URL(MODEL_HOST).host} ${route.proxy ? `via ${route.proxy}` : "directly"}: ${why}`, {
      cause: error,
    });
  }
}
