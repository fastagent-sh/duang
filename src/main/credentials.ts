// No fallback to the CLI's or pi's store: one OAuth grant in two files breaks when either refreshes,
// since providers rotate the refresh token.
import { join } from "node:path";
import { app } from "electron";
import { availableModelsFromDir, refreshModelCatalog } from "@fastagent-sh/fastagent/pi";
import type { ModelDescriptor } from "@fastagent-sh/fastagent/session";
import { inflight } from "./inflight.ts";
import { retired } from "./providers.ts";

export const authPath = join(app.getPath("userData"), "auth.json");

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
