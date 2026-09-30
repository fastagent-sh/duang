/**
 * duang's own credential file: the one file the picker, every runtime, plan usage and sign-in read and
 * write. It is not the `fastagent` CLI's or pi's store, and nothing falls back to them: one OAuth grant
 * in two files is invalidated by whichever refreshes first, since providers rotate the refresh token.
 */
import { join } from "node:path";
import { app } from "electron";
import { availableModelsFromDir } from "@fastagent-sh/fastagent/pi";

export const authPath = join(app.getPath("userData"), "auth.json");

/** What the picker shows: the specs this agent can run. */
export interface Models {
  specs: string[];
}

/**
 * The agent's own list — built-ins plus its `models.json` — read through the file its runtime uses.
 * Configuration, not a network health check: OAuth refresh and provider errors are left to execution.
 */
export async function modelsFor(dir: string): Promise<Models> {
  const specs = await availableModelsFromDir(dir, {
    authPath,
    // A corrupt or unreadable file must be an error here, not an empty list.
    warn(message) {
      throw new Error(message);
    },
  });
  return { specs };
}
