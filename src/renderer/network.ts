/** The manual proxy form, as data: pure so it runs under `node --test`. */

export const KINDS = [
  { scheme: "http", label: "HTTP" },
  { scheme: "https", label: "HTTPS" },
  { scheme: "socks5", label: "SOCKS5" },
] as const;
export type Scheme = (typeof KINDS)[number]["scheme"];

/** Server and port as a proxy URL, or the reason they are not one yet. */
export function manualUrl(scheme: Scheme, server: string, port: string): { url: string } | { error: string } {
  const host = server.trim();
  if (!host) return { error: "Server is required" };
  if (/[\s/]/.test(host) || host.includes("://")) return { error: "Server is a host name or address, without a scheme or path" };
  const number = Number(port.trim());
  if (!/^\d+$/.test(port.trim()) || number < 1 || number > 65535) return { error: "Port is a number from 1 to 65535" };
  return { url: `${scheme}://${host}:${number}` };
}


/**
 * A saved manual proxy back into the form's fields. Read from the string, not through `URL`: the
 * WHATWG parser reports a scheme's default port as "" (`http://proxy.corp:80`), and main always
 * saves the port explicitly so it can be shown again. Anything else was not written by main.
 */
export function manualFields(url: string): { scheme: Scheme; server: string; port: string } {
  const match = /^(https?|socks5):\/\/(.+):(\d+)$/.exec(url);
  if (!match) throw new Error(`Saved proxy is not scheme://host:port: ${url}`);
  return { scheme: match[1] as Scheme, server: match[2]!, port: match[3]! };
}
