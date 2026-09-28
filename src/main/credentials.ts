/** One credential file for the picker and every runtime, independent of the agent's default model. */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { availableModelsFromDir, GLOBAL_AUTH_PATH } from "@fastagent-sh/fastagent/pi";

/** FastAgent expands a leading `~` for the same variable; a GUI's environment rarely has a shell to do it. */
function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
}

export const authPath = resolve(expandHome(process.env.FASTAGENT_AUTH_PATH || GLOBAL_AUTH_PATH));

/** What the picker shows: the specs this agent can run, and the credential file its runtimes use. */
export interface Models {
  specs: string[];
  authPath: string;
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
  return { specs, authPath };
}
