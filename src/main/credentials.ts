/**
 * Which providers this machine can actually run, from either global credential store.
 *
 * FastAgent's own resolution answers first; pi's global file covers the providers it does not have,
 * because someone who has only ever logged in through pi has working credentials and no reason to do
 * it again. A spec whose provider has no credential fails on the first turn — the worst moment to
 * learn it — so the picker never offers one.
 *
 * The two stores cannot be merged into one agent: `createPiAgentFromDir` takes a single `authPath`
 * (naming one disables FastAgent's own fallback). So the file is chosen per provider instead.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPiModels, listModels, type Models } from "@fastagent-sh/fastagent/pi";
import { log } from "./log.ts";

const PI_GLOBAL_AUTH = join(homedir(), ".pi", "agent", "auth.json");

const providerOf = (spec: string): string => spec.slice(0, spec.indexOf("/"));

/** Auth is provider-scoped, so any one of its models probes it. */
async function readyProviders(models: Models): Promise<Set<string>> {
  const ready = new Set<string>();
  for (const provider of models.getProviders()) {
    const [probe] = provider.getModels();
    if (probe && (await models.getAuth(probe).catch(() => undefined))) ready.add(provider.id);
  }
  return ready;
}

export interface Credentials {
  /** Model specs whose provider is usable here. */
  specs: string[];
  /** Providers that only pi's store has — agents on these must be opened against pi's file. */
  piOnly: Set<string>;
}

// ponytail: probed once per app run. A `fastagent login` while duang is open needs a restart to show up.
let probe: Promise<Credentials> | undefined;

export function credentials(): Promise<Credentials> {
  probe ??= (async () => {
    const own = createPiModels();
    const ownReady = await readyProviders(own);
    const piReady = existsSync(PI_GLOBAL_AUTH)
      ? await readyProviders(createPiModels({ authPath: PI_GLOBAL_AUTH }))
      : new Set<string>();
    const piOnly = new Set([...piReady].filter((id) => !ownReady.has(id)));
    const ready = new Set([...ownReady, ...piOnly]);

    const specs = listModels(own).filter((spec) => ready.has(providerOf(spec)));
    log(
      ready.size === 0
        ? "credentials: none — run `fastagent login` first"
        : `credentials: ${[...ownReady].join(", ") || "none"} (fastagent)` +
            `${piOnly.size ? ` + ${[...piOnly].join(", ")} (pi)` : ""} — ${specs.length} models`,
    );
    return { specs, piOnly };
  })();
  return probe;
}

/** The credential file an agent on this model must be opened against, if not FastAgent's own. */
export async function authPathFor(model: string | undefined): Promise<string | undefined> {
  if (!model) return undefined;
  const { piOnly } = await credentials();
  return piOnly.has(providerOf(model)) ? PI_GLOBAL_AUTH : undefined;
}
