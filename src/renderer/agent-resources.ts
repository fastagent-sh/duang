import type { AgentCommand } from "@fastagent-sh/fastagent/session";
import type { DuangApi, Models } from "../preload/index.ts";
import { message } from "./message.ts";

export interface AgentResourcesView {
  models?: Models;
  modelsError?: string;
  modelsRefresh?: { status: "running" } | { status: "done"; added: number } | { status: "failed"; error: string };
  commands: AgentCommand[];
  commandsError?: string;
}

export function createAgentResources(
  api: DuangApi,
  snapshot: () => AgentResourcesView & { agentId?: string },
  publish: (patch: Partial<AgentResourcesView>) => void,
) {
  let modelsRequest = 0;
  let commandsFor: string | undefined;
  return {
    select: () => { commandsFor = undefined; },
    // Read on every opening: the agent's `models.json` and Settings' provider changes show up.
    async loadModels() {
      const id = snapshot().agentId;
      const request = ++modelsRequest;
      publish({ models: undefined, modelsError: undefined, modelsRefresh: undefined });
      if (!id) return;
      try {
        const models = await api.listModels(id);
        if (request === modelsRequest) publish({ models });
      } catch (error) {
        if (request === modelsRequest) publish({ modelsError: message(error) });
      }
    },
    // A failed refresh keeps the list: the models already there are no less runnable.
    async refreshModels() {
      const { agentId: id, models } = snapshot();
      // Not before the list has arrived: there would be nothing to count against, and the reading in flight
      // would be dropped (a failure then leaves a picker with no list and nothing to retry).
      if (!id || !models || snapshot().modelsRefresh?.status === "running") return;
      const request = ++modelsRequest;
      const before = new Set(models.map((model) => model.spec));
      publish({ modelsRefresh: { status: "running" } });
      try {
        const models = await api.refreshModels(id);
        if (request !== modelsRequest || snapshot().agentId !== id) return;
        publish({ models, modelsRefresh: { status: "done", added: models.filter((model) => !before.has(model.spec)).length } });
      } catch (error) {
        if (request === modelsRequest && snapshot().agentId === id)
          publish({ modelsRefresh: { status: "failed", error: message(error) } });
      }
    },
    async loadCommands() {
      const id = snapshot().agentId;
      if (!id || commandsFor === id) return;
      commandsFor = id;
      try {
        const commands = await api.listCommands(id);
        if (commandsFor === id) publish({ commands });
      } catch (error) {
        // Without this the agent keeps an empty completion list; the next `/` retries.
        if (commandsFor === id) {
          commandsFor = undefined;
          publish({ commandsError: message(error) });
        }
      }
    },
  };
}
