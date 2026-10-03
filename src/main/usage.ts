/**
 * A subscription's rate-limit windows (Claude 5h/7d, ChatGPT primary/secondary), read from the
 * endpoints the providers' own clients use. Neither endpoint is documented, so a changed shape is an
 * error with the provider's words, never an empty result.
 *
 * The token comes from FastAgent's `getAuth`, which refreshes an expired OAuth login under the
 * credential file's lock — the same path a run takes — so duang is never a second writer. The token
 * stays in main; the renderer gets numbers.
 */
import { createPiModels } from "@fastagent-sh/fastagent/pi";

export interface UsageWindow {
  /** "5h", "7d": the window's length, as a person names it. */
  label: string;
  /** 0–100, used. */
  percent: number;
  /** Epoch ms, when known. */
  resetsAt?: number;
  windowSeconds: number;
}

/** Undefined `windows` means the provider has none to report for this credential (an API key). */
export interface ProviderUsage {
  provider: string;
  windows?: UsageWindow[];
  fetchedAt: number;
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

export function parseChatGPT(body: unknown): UsageWindow[] {
  type Window = { used_percent?: number; reset_at?: number | null; limit_window_seconds?: number };
  type Limits = { primary_window?: Window | null; secondary_window?: Window | null };
  const limits = need((body as { rate_limit?: Limits }).rate_limit, "rate_limit");
  const window = (w: Window | null | undefined, fallback: number, name: string): UsageWindow | undefined => {
    if (!w) return undefined;
    const seconds = w.limit_window_seconds && w.limit_window_seconds > 0 ? w.limit_window_seconds : fallback;
    return {
      label: label(seconds),
      percent: need(w.used_percent, `${name}.used_percent`),
      ...(w.reset_at ? { resetsAt: w.reset_at * 1000 } : {}),
      windowSeconds: seconds,
    };
  };
  // A plan may have only one window (a weekly-only ChatGPT plan answers with just `primary_window`
  // at 604800s), so the length comes from the response, and the fallbacks only name the usual ones.
  const present = [
    window(limits.primary_window, 5 * HOUR, "primary_window"),
    window(limits.secondary_window, 7 * DAY, "secondary_window"),
  ].filter((w): w is UsageWindow => !!w);
  if (!present.length) throw new Error("usage response has neither primary_window nor secondary_window");
  return present;
}

/** The ChatGPT account the token belongs to, which the usage route requires as a header. */
function chatgptAccount(token: string): string {
  const payload = token.split(".")[1];
  const claims = payload ? JSON.parse(Buffer.from(payload, "base64url").toString()) : undefined;
  const account = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id as string | undefined;
  if (!account) throw new Error("the ChatGPT login's token carries no ChatGPT account id");
  return account;
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
  // Sign in with ChatGPT on `openai`. The route is the one ChatGPT's own Codex client reads.
  openai: async (token) =>
    parseChatGPT(
      await get("https://chatgpt.com/backend-api/wham/usage", {
        authorization: `Bearer ${token}`,
        "chatgpt-account-id": chatgptAccount(token),
      }),
    ),
};

async function read(provider: string, authPath: string): Promise<ProviderUsage> {
  const fetchedAt = Date.now();
  const endpoint = endpoints[provider];
  if (!endpoint) return { provider, fetchedAt };
  const models = createPiModels({ authPath });
  // Only a subscription login has windows; an API key's limits are per request, not per plan.
  if ((await models.checkAuth(provider))?.type !== "oauth") return { provider, fetchedAt };
  const token = (await models.getAuth(provider))?.auth.apiKey;
  if (!token) throw new Error(`${provider} has no usable login`);
  return { provider, windows: await endpoint(token), fetchedAt };
}

/**
 * One answer per login per gap, shared by concurrent callers: keyed by the file and the provider,
 * since the file is what holds the login. A failure is kept for the gap too: retrying a 429 sooner
 * is how it stays a 429.
 */
const recent = new Map<string, { at: number; answer: Promise<ProviderUsage> }>();

/**
 * A provider's login in that file changed (connected, replaced, disconnected): the next ask reads the
 * new one instead of the old login's answer for the rest of the gap.
 */
export function forgetUsage(provider: string, authPath: string): void {
  recent.delete(`${authPath}\0${provider}`);
}

/** `authPath` is the credential file whose login pays for the conversation: duang's own. */
export function providerUsage(provider: string, authPath: string, now = Date.now()): Promise<ProviderUsage> {
  const key = `${authPath}\0${provider}`;
  const hit = recent.get(key);
  if (hit && now - hit.at < MIN_GAP_MS) return hit.answer;
  const answer = read(provider, authPath);
  recent.set(key, { at: now, answer });
  return answer;
}
