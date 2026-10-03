/**
 * Model providers for duang's own credential file: what can be connected, what is, and one sign-in at
 * a time. FastAgent's `login` runs each provider's flow; this module relays its questions to the
 * window and its answers back, and never hands the window a credential.
 *
 * No Electron import, so it runs under `node --test`: the caller supplies the file and a way to open a
 * URL in the system browser.
 */
import { existsSync } from "node:fs";
import {
  createPiModels,
  fastagentCredentialStore,
  login,
  LoginCancelled,
  loginOptions,
  type AuthEvent,
  type AuthPrompt,
  type LoginMethod,
} from "@fastagent-sh/fastagent/pi";

export type { LoginMethod };

export interface ProviderRow {
  id: string;
  /** pi's own name for the provider; duang adds none. */
  name: string;
  /** How it can be connected, each by FastAgent's own label ("Anthropic (Claude Pro/Max)"). */
  ways: { method: LoginMethod; label: string; subscription: boolean }[];
  /** What duang's file holds for it. */
  stored?: LoginMethod;
  /** A credential from outside the file that also serves it: an env var name, `~/.aws/credentials`. */
  ambient?: string;
}

/**
 * Providers pi keeps only for old logins, which duang does not offer: `openai-codex` is ChatGPT's
 * subscription through chatgpt.com, which pi replaced with Sign in with ChatGPT on `openai` itself. Not
 * listed to connect, its models are not offered, and nothing runs on them.
 */
const RETIRED = new Set(["openai-codex"]);
/** Whether a provider, or a model spec's provider, is one duang no longer runs. */
export const retired = (providerOrSpec: string) => RETIRED.has(providerOrSpec.split("/")[0]!);

/** A corrupt or unreadable file is an error, never "nothing connected". */
const loud = (message: string) => {
  throw new Error(message);
};

/**
 * Every provider pi can sign in to, with what serves it now. `ambient` is read over an empty store,
 * because a credential in the file hides an environment variable for the same provider, and the
 * person disconnecting must be told the variable will keep answering. `empty` must not exist; it is
 * only read.
 */
export async function listProviders(authPath: string, empty: string): Promise<ProviderRow[]> {
  // A file there would be read as the ambient sources, and name ones that do not exist.
  if (existsSync(empty)) throw new Error(`${empty} must not exist: duang reads it as "no stored credentials". Remove it.`);
  const held = new Map(
    (await fastagentCredentialStore(authPath, { warn: loud }).list()).map((info) => [info.providerId, info.type]),
  );
  const names = new Map(createPiModels({ authPath, warn: loud }).getProviders().map((p) => [p.id, p.name]));
  const ambient = createPiModels({ authPath: empty, warn: loud });
  const rows = new Map<string, ProviderRow>();
  for (const option of await loginOptions(authPath)) {
    if (retired(option.provider)) continue;
    let row = rows.get(option.provider);
    if (!row) {
      const stored = held.get(option.provider);
      const source = (await ambient.checkAuth(option.provider))?.source;
      row = {
        id: option.provider,
        name: names.get(option.provider) ?? option.provider,
        ways: [],
        ...(stored ? { stored } : {}),
        ...(source ? { ambient: source } : {}),
      };
      rows.set(option.provider, row);
    }
    row.ways.push({ method: option.method, label: option.label, subscription: option.subscription });
  }
  return [...rows.values()];
}

export async function disconnect(authPath: string, provider: string): Promise<void> {
  await fastagentCredentialStore(authPath, { warn: loud }).delete(provider);
}

/** Per variant, so each prompt keeps its own fields (`options`, `placeholder`) once the signal is gone. */
type WithoutSignal<T> = T extends unknown ? Omit<T, "signal"> : never;

/** What the window is shown: a question to answer, one withdrawn, or something to display. */
export type LoginStep =
  | { type: "prompt"; id: string; prompt: WithoutSignal<AuthPrompt> }
  | { type: "dismiss"; id: string }
  | AuthEvent;

export type LoginOutcome =
  | { ok: true; verified: "ok" | "unknown" | "n/a" }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: never; error: string };

/**
 * Only `https:`, or `http:` to this machine (an OAuth callback server): a flow's URL is opened in the
 * system browser, and nothing else may reach `shell.openExternal` through it.
 */
export function openable(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
  } catch {
    return false;
  }
}

/**
 * One sign-in: relays prompts to `send`, resolves them from `answer`, and ends on `cancel`. A URL can
 * be reopened only if this flow reported it. `run` is FastAgent's `login`, replaceable in tests.
 */
export function startLogin(options: {
  provider: string;
  method: LoginMethod;
  authPath: string;
  send: (step: LoginStep) => void;
  /** Opens the system browser; rejects when it cannot (no default browser, `xdg-open` failing). */
  open: (url: string) => Promise<void>;
  run?: typeof login;
}) {
  const { provider, method, authPath, send, open, run = login } = options;
  const abort = new AbortController();
  const pending = new Map<string, (value: string) => void>();
  const reported = new Set<string>();
  let next = 0;
  const report = (url: string) => {
    if (!openable(url)) return false;
    reported.add(url);
    return true;
  };

  const result: Promise<LoginOutcome> = run({
    provider,
    method,
    authPath,
    interaction: {
      signal: abort.signal,
      prompt(prompt) {
        const { signal, ...shown } = prompt;
        const id = String(++next);
        return new Promise<string>((resolve, reject) => {
          const withdraw = () => {
            pending.delete(id);
            send({ type: "dismiss", id });
            reject(signal?.reason ?? abort.signal.reason ?? new Error("prompt withdrawn"));
          };
          if (signal?.aborted || abort.signal.aborted) return withdraw();
          signal?.addEventListener("abort", withdraw, { once: true });
          abort.signal.addEventListener("abort", withdraw, { once: true });
          pending.set(id, (value) => {
            signal?.removeEventListener("abort", withdraw);
            abort.signal.removeEventListener("abort", withdraw);
            pending.delete(id);
            resolve(value);
          });
          send({ type: "prompt", id, prompt: shown });
        });
      },
      notify(event) {
        // The browser opens by itself for a sign-in; everything else is opened on request. A browser
        // that does not open is said in the sign-in's row, where Copy link is the way on.
        if (event.type === "auth_url" && report(event.url))
          open(event.url).catch((error: unknown) =>
            send({ type: "info", message: `The browser did not open (${(error as Error).message}). Copy the link instead.` }),
          );
        if (event.type === "device_code") report(event.verificationUri);
        if (event.type === "info") for (const link of event.links ?? []) report(link.url);
        send(event);
      },
    },
  }).then(
    (done): LoginOutcome => ({ ok: true, verified: done.verified }),
    (error: unknown): LoginOutcome =>
      error instanceof LoginCancelled ? { ok: false, cancelled: true }
        : { ok: false, error: error instanceof Error ? error.message : String(error) },
  );

  return {
    result,
    /** The window's answer to prompt `id`. One that is not pending was withdrawn meanwhile. */
    answer(id: string, value: string) {
      pending.get(id)?.(value);
    },
    cancel() {
      abort.abort();
    },
    /** Opens a URL this flow reported, again. Rejects when the browser cannot be opened. */
    async reopen(url: string) {
      if (!reported.has(url)) throw new Error("Not a URL this sign-in reported");
      await open(url);
    },
  };
}
