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

export function createAgentResources(api: DuangApi, publish: (patch: Partial<AgentResourcesView>) => void) {
  let selected: { id: string } | undefined;
  let modelRead: object | undefined;
  let commandsFor: typeof selected;
  let models: Models | undefined;
  let refreshing = false;
  return {
    select(id?: string) {
      selected = id ? { id } : undefined;
      modelRead = commandsFor = undefined;
      models = undefined;
      refreshing = false;
      publish({ models: undefined, modelsError: undefined, modelsRefresh: undefined, commands: [], commandsError: undefined });
    },
    closeModels() {
      modelRead = undefined;
      refreshing = false;
      publish({ modelsRefresh: undefined });
    },
    async loadModels() {
      const origin = selected;
      const request = (modelRead = {});
      models = undefined;
      refreshing = false;
      publish({ models: undefined, modelsError: undefined, modelsRefresh: undefined });
      if (!origin) return;
      try {
        const answer = await api.listModels(origin.id);
        if (selected !== origin || modelRead !== request) return;
        models = answer;
        publish({ models });
      } catch (error) {
        if (selected === origin && modelRead === request) publish({ modelsError: message(error) });
      }
    },
    async refreshModels() {
      const origin = selected;
      if (!origin || !models || refreshing) return;
      const request = (modelRead = {});
      const before = new Set(models.map((model) => model.spec));
      refreshing = true;
      publish({ modelsRefresh: { status: "running" } });
      try {
        const answer = await api.refreshModels(origin.id);
        if (selected !== origin || modelRead !== request) return;
        models = answer;
        refreshing = false;
        publish({ models, modelsRefresh: { status: "done", added: models.filter((model) => !before.has(model.spec)).length } });
      } catch (error) {
        if (selected !== origin || modelRead !== request) return;
        refreshing = false;
        publish({ modelsRefresh: { status: "failed", error: message(error) } });
      }
    },
    async loadCommands() {
      const origin = selected;
      if (!origin || commandsFor === origin) return;
      commandsFor = origin;
      try {
        const commands = await api.listCommands(origin.id);
        if (selected === origin) publish({ commands, commandsError: undefined });
      } catch (error) {
        if (selected !== origin) return;
        commandsFor = undefined;
        publish({ commandsError: message(error) });
      }
    },
  };
}
