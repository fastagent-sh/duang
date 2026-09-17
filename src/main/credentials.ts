/** One credential file for the picker and every runtime, independent of the agent's default model. */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createPiModels, GLOBAL_AUTH_PATH } from "@fastagent-sh/fastagent/pi";

/** FastAgent expands a leading `~` for the same variable; a GUI's environment rarely has a shell to do it. */
function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
}

export const authPath = resolve(expandHome(process.env.FASTAGENT_AUTH_PATH || GLOBAL_AUTH_PATH));

export async function credentials(): Promise<{ specs: string[]; authPath: string }> {
  const models = createPiModels({
    authPath,
    warn(message) {
      throw new Error(message);
    },
  });
  // Configuration, not a network health check: leave OAuth refresh and provider errors to execution.
  const available = await models.getAvailable();
  return { specs: available.map((model) => `${model.provider}/${model.id}`).sort(), authPath };
}
