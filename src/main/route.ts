/**
 * The route a request takes, decided per connection by whoever knows the system's proxy rules
 * (Chromium, in the app) and carried out by undici. No Electron import, so it runs under `node --test`.
 */
import { Agent, Dispatcher, ProxyAgent, Socks5ProxyAgent } from "undici";

/**
 * A PAC answer ("PROXY h:p; DIRECT") as the proxy URL to use, or undefined for a direct connection.
 * ponytail: only the first entry is used; honour the fallback list when someone's PAC relies on it.
 */
export function routeOf(pac: string): string | undefined {
  const [kind = "", host] = pac.split(";")[0]!.trim().split(/\s+/);
  switch (kind.toUpperCase()) {
    case "DIRECT":
      return undefined;
    case "PROXY":
      return `http://${host}`;
    case "HTTPS":
      return `https://${host}`;
    case "SOCKS5":
      return `socks5://${host}`;
    default:
      throw new Error(`Unsupported proxy route "${pac}": only PROXY, HTTPS and SOCKS5 are`);
  }
}

/** An agent whose every connection fails with `error`, so a routing failure reaches the caller as a request error. */
const failing = (error: Error) =>
  new Agent({
    connect: (_options, callback) => callback(error, null),
  });

/**
 * Asks `resolve` for each request's route and hands the request to the agent for it. The answer is
 * not cached: a VPN switched on or off is seen by the next request, which is the point.
 */
export class RoutedDispatcher extends Dispatcher {
  private agents = new Map<string, Dispatcher>();
  private resolve: (origin: string) => Promise<string>;
  constructor(resolve: (origin: string) => Promise<string>) {
    super();
    this.resolve = resolve;
  }

  private agentFor(proxy: string | undefined): Dispatcher {
    const key = proxy ?? "DIRECT";
    let agent = this.agents.get(key);
    if (!agent) {
      agent = !proxy
        ? new Agent()
        : proxy.startsWith("socks5:")
          ? new Socks5ProxyAgent(proxy)
          : new ProxyAgent(proxy);
      this.agents.set(key, agent);
    }
    return agent;
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    this.resolve(String(options.origin)).then(
      (pac) => {
        let agent: Dispatcher;
        try {
          agent = this.agentFor(routeOf(pac));
        } catch (error) {
          agent = failing(error as Error);
        }
        agent.dispatch(options, handler);
      },
      (error: Error) => failing(new Error(`Could not resolve a route: ${error.message}`)).dispatch(options, handler),
    );
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([...this.agents.values()].map((agent) => agent.close()));
  }

  async destroy(): Promise<void> {
    await Promise.all([...this.agents.values()].map((agent) => agent.destroy()));
  }
}

/**
 * What an agent's shell commands (git, npm, curl) should see: one proxy for everything, loopback
 * direct, in both spellings because curl reads only the lowercase `http_proxy`. Undefined means
 * "remove". Per-host PAC rules and the system bypass list cannot be expressed in these variables, so
 * they do not reach child processes.
 */
export function commandProxyEnv(proxy: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) env[name] = env[name.toLowerCase()] = proxy;
  env.NO_PROXY = env.no_proxy = proxy && "localhost,127.0.0.1,::1";
  return env;
}
