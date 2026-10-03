/**
 * duang's own credential file: the one file the picker, every runtime, plan usage and sign-in read and
 * write. It is not the `fastagent` CLI's or pi's store, and nothing falls back to them: one OAuth grant
 * in two files is invalidated by whichever refreshes first, since providers rotate the refresh token.
 */
import { join } from "node:path";
import { app } from "electron";
import { availableModelsFromDir, refreshModelCatalog } from "@fastagent-sh/fastagent/pi";
import type { ModelDescriptor } from "@fastagent-sh/fastagent/session";
import { inflight } from "./inflight.ts";
import { retired } from "./providers.ts";

export const authPath = join(app.getPath("userData"), "auth.json");

/**
 * What the picker shows: the models this agent can run, as FastAgent describes them (`spec`, and the
 * `name`, `thinkingLevels` and `contextWindow` the model declares).
 */
export type Models = ModelDescriptor[];

/** The credential file every read here goes through. */
const credentials = {
  authPath,
  // A corrupt or unreadable file must be an error here, not an empty list.
  warn(message: string): never {
    throw new Error(message);
  },
};

/**
 * The agent's own list — built-ins plus its `models.json` — read through the file its runtime uses.
 * Configuration, not a network health check: OAuth refresh and provider errors are left to execution.
 */
export async function modelsFor(dir: string): Promise<Models> {
  return (await availableModelsFromDir(dir, credentials)).filter((model) => !retired(model.spec));
}

/**
 * Asks pi.dev for models released after the bundled catalog, for the providers this agent's credentials
 * authenticate, and saves the answer as `models-store.json` in the agent's folder (FastAgent's own
 * file: it is part of the agent's definition). Only a person asking does this: nothing refreshes on
 * its own. It rejects, naming each provider that failed, on an error, after 15 seconds, or under
 * `PI_OFFLINE`; the old list stays valid. A refresh already running for the folder (the picker was
 * reopened and pressed again) is joined, not repeated.
 */
export const refreshModels = inflight(async (dir: string): Promise<Models> => {
  await refreshModelCatalog(dir, credentials);
  return modelsFor(dir);
});
