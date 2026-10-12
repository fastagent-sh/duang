import { availableModelsFromDir, refreshModelCatalog } from "@fastagent-sh/fastagent/pi";
import type { ModelDescriptor } from "@fastagent-sh/fastagent/session";
import { authPath } from "./credential-file.ts";
import { inflight } from "./inflight.ts";
import { retired } from "./providers.ts";

export type Models = ModelDescriptor[];

const credentials = {
  authPath,
  // A corrupt or unreadable file must be an error here, not an empty list.
  warn(message: string): never {
    throw new Error(message);
  },
};

// Configuration, not a health check: OAuth refresh and provider errors surface at execution.
export async function modelsFor(dir: string): Promise<Models> {
  return (await availableModelsFromDir(dir, credentials)).filter((model) => !retired(model.spec));
}

/** Whether the agent can run this model now: its own `models.json`, the shared one, and pi's catalog. */
export async function offered(dir: string, model: string): Promise<boolean> {
  return (await modelsFor(dir)).some((candidate) => candidate.spec === model);
}

// Only on request, never on its own; when it rejects the old list stays valid.
export const refreshModels = inflight(async (dir: string): Promise<Models> => {
  await refreshModelCatalog(dir, credentials);
  return modelsFor(dir);
});
