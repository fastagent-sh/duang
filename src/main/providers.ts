// No Electron import, so it runs under `node --test`. The window never receives a credential.
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
  name: string;
  ways: { method: LoginMethod; label: string; subscription: boolean }[];
  stored?: LoginMethod;
  ambient?: string;
}

// pi keeps `openai-codex` only for old logins; Sign in with ChatGPT on `openai` replaced it.
const RETIRED = new Set(["openai-codex"]);
export const retired = (providerOrSpec: string) => RETIRED.has(providerOrSpec.split("/")[0]!);

/** A corrupt or unreadable file is an error, never "nothing connected". */
const loud = (message: string) => {
  throw new Error(message);
};

// `ambient` is read over an empty store: a stored credential hides an env variable that keeps answering
// after a disconnect.
export async function listProviders(authPath: string, empty: string): Promise<ProviderRow[]> {
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

// Distributes over the union so each variant keeps its own fields.
type WithoutSignal<T> = T extends unknown ? Omit<T, "signal"> : never;

export type LoginStep =
  | { type: "prompt"; id: string; prompt: WithoutSignal<AuthPrompt> }
  | { type: "dismiss"; id: string }
  | AuthEvent;

export type LoginOutcome =
  | { ok: true; verified: "ok" | "unknown" | "n/a" }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: never; error: string };

// Only `https:`, or `http:` to loopback (an OAuth callback): nothing else may reach `shell.openExternal`.
export function openable(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
  } catch {
    return false;
  }
}

export function startLogin(options: {
  provider: string;
  method: LoginMethod;
  authPath: string;
  send: (step: LoginStep) => void;
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
    answer(id: string, value: string) {
      pending.get(id)?.(value);
    },
    cancel() {
      abort.abort();
    },
    async reopen(url: string) {
      if (!reported.has(url)) throw new Error("Not a URL this sign-in reported");
      await open(url);
    },
  };
}
