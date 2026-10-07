// The endpoint is undocumented: a changed shape is an error, never an empty result. ChatGPT's usage route
// refuses our token, so that login answers with its `page`. `getAuth` refreshes under the file's lock.
import { createPiModels } from "@fastagent-sh/fastagent/pi";

export interface UsageWindow {
  label: string;
  percent: number;
  resetsAt?: number;
  windowSeconds: number;
}

export interface ProviderUsage {
  provider: string;
  windows?: UsageWindow[];
  page?: string;
  fetchedAt: number;
}

// Main owns the address: the window never hands main a URL to open.
const PAGES: Record<string, { plan: string; url: string }> = {
  // Sign in with ChatGPT (OpenAI's guidance: https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
  openai: { plan: "ChatGPT", url: "https://chatgpt.com/settings/usage" },
};
export function usagePage(provider: string): string {
  const page = PAGES[provider];
  if (!page) throw new Error(`${provider} has no usage page`);
  return page.url;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const TIMEOUT_MS = 10_000;
/** Anthropic's endpoint answers 429 when polled; a turn ending every minute must not poll it. */
export const MIN_GAP_MS = 3 * 60 * 1000;

const label = (seconds: number) => (seconds % DAY === 0 ? `${seconds / DAY}d` : `${Math.round(seconds / HOUR)}h`);

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`usage response has no ${what}`);
  return value;
}

export function parseAnthropic(body: unknown): UsageWindow[] {
  type Window = { utilization?: number; resets_at?: string | null };
  const data = body as { five_hour?: Window | null; seven_day?: Window | null };
  const window = (w: Window | null | undefined, seconds: number, name: string): UsageWindow | undefined => {
    if (!w) return undefined;
    const resetsAt = w.resets_at ? Date.parse(w.resets_at) : undefined;
    return {
      label: label(seconds),
      percent: need(w.utilization, `${name}.utilization`),
      ...(resetsAt !== undefined && Number.isFinite(resetsAt) ? { resetsAt } : {}),
      windowSeconds: seconds,
    };
  };
  const windows = [window(data.five_hour, 5 * HOUR, "five_hour"), window(data.seven_day, 7 * DAY, "seven_day")];
  const present = windows.filter((w): w is UsageWindow => !!w);
  if (!present.length) throw new Error("usage response has neither five_hour nor seven_day");
  return present;
}

async function get(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`${new URL(url).host} answered ${response.status}: ${body}`);
  }
  return response.json();
}

const endpoints: Record<string, (token: string) => Promise<UsageWindow[]>> = {
  anthropic: async (token) =>
    parseAnthropic(
      await get("https://api.anthropic.com/api/oauth/usage", {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      }),
    ),
};

async function read(provider: string, authPath: string): Promise<ProviderUsage> {
  const fetchedAt = Date.now();
  const endpoint = endpoints[provider];
  if (!endpoint && !PAGES[provider]) return { provider, fetchedAt };
  const models = createPiModels({ authPath });
  if ((await models.checkAuth(provider))?.type !== "oauth") return { provider, fetchedAt };
  if (!endpoint) return { provider, page: PAGES[provider]!.plan, fetchedAt };
  const token = (await models.getAuth(provider))?.auth.apiKey;
  if (!token) throw new Error(`${provider} has no usable login`);
  return { provider, windows: await endpoint(token), fetchedAt };
}

// A failure is kept for the gap too: retrying a 429 sooner keeps it a 429.
const recent = new Map<string, { at: number; answer: Promise<ProviderUsage> }>();

export function forgetUsage(provider: string, authPath: string): void {
  recent.delete(`${authPath}\0${provider}`);
}

export function providerUsage(provider: string, authPath: string, now = Date.now()): Promise<ProviderUsage> {
  const key = `${authPath}\0${provider}`;
  const hit = recent.get(key);
  if (hit && now - hit.at < MIN_GAP_MS) return hit.answer;
  const answer = read(provider, authPath);
  recent.set(key, { at: now, answer });
  return answer;
}
