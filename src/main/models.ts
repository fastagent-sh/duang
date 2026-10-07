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

// Only on request, never on its own; when it rejects the old list stays valid.
export const refreshModels = inflight(async (dir: string): Promise<Models> => {
  await refreshModelCatalog(dir, credentials);
  return modelsFor(dir);
});
