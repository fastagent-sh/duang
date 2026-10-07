// The renderer's whole privilege.
import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentCommand,
  SessionEntries,
  SessionEvent,
  SessionResult,
  SessionState,
  SessionSummary,
} from "@fastagent-sh/fastagent/session";

export type { AgentRow } from "../main/agent-files.ts";
import type { AgentRow } from "../main/agent-files.ts";
export type { Models } from "../main/credentials.ts";
import type { Models } from "../main/credentials.ts";
export type { ProviderUsage, UsageWindow } from "../main/usage.ts";
export type { AvatarStyle, Network } from "../main/settings.ts";
import type { AvatarStyle, Network, Settings } from "../main/settings.ts";
export type { Route } from "../main/proxy.ts";
export type { LoginMethod, LoginOutcome, LoginStep, ProviderRow } from "../main/providers.ts";
import type { LoginMethod, LoginOutcome, LoginStep, ProviderRow } from "../main/providers.ts";
import type { ConnectionCheck, Route } from "../main/proxy.ts";
import type { Frame } from "../main/follow.ts";
import type { ProviderUsage } from "../main/usage.ts";

export type OpenResult =
  | { ok: true; sessions: SessionSummary[]; model?: string; staleDefault?: string }
  | {
      ok: false;
      code: "no_agent" | "missing_dir" | "broken";
      message: string;
      inConfig?: true;
    };

export type SessionFrame = Frame<SessionEvent>;

const api = {
  listAgents: (): Promise<AgentRow[]> => ipcRenderer.invoke("agents:list"),
  addAgent: (): Promise<AgentRow | undefined> => ipcRenderer.invoke("agents:add"),
  openAgent: (agentId: string): Promise<OpenResult> => ipcRenderer.invoke("agent:open", agentId),
  setModel: (agentId: string, model: string, session?: string): Promise<SessionResult> =>
    ipcRenderer.invoke("agent:setModel", agentId, model, session),
  setThinking: (agentId: string, session: string, level: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:setThinking", agentId, session, level),
  renameAgent: (agentId: string, name: string): Promise<void> => ipcRenderer.invoke("agent:rename", agentId, name),
  removeAgent: (agentId: string): Promise<SessionResult> => ipcRenderer.invoke("agent:remove", agentId),
  relocateAgent: (agentId: string): Promise<SessionResult | undefined> => ipcRenderer.invoke("agent:relocate", agentId),
  resetAgentConfig: (agentId: string): Promise<SessionResult> => ipcRenderer.invoke("agent:resetConfig", agentId),
  scaffoldAgent: (agentId: string): Promise<string> => ipcRenderer.invoke("agent:scaffold", agentId),
  listCommands: (agentId: string): Promise<AgentCommand[]> => ipcRenderer.invoke("agent:commands", agentId),
  revealAgent: (agentId: string): Promise<void> => ipcRenderer.invoke("agent:reveal", agentId),
  revealRegistry: (): Promise<void> => ipcRenderer.invoke("registry:reveal"),
  listModels: (agentId: string): Promise<Models> => ipcRenderer.invoke("models:list", agentId),
  refreshModels: (agentId: string): Promise<Models> => ipcRenderer.invoke("models:refresh", agentId),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  getRoute: (): Promise<Route> => ipcRenderer.invoke("network:route"),
  setAvatar: (style: AvatarStyle): Promise<void> => ipcRenderer.invoke("settings:setAvatar", style),
  setNetwork: (network: Network): Promise<Route> => ipcRenderer.invoke("settings:setNetwork", network),
  revealSettings: (): Promise<void> => ipcRenderer.invoke("settings:reveal"),
  testNetwork: (): Promise<ConnectionCheck> => ipcRenderer.invoke("network:test"),
  listProviders: (): Promise<ProviderRow[]> => ipcRenderer.invoke("providers:list"),
  revealProviders: (): Promise<void> => ipcRenderer.invoke("providers:reveal"),
  disconnect: (provider: string): Promise<void> => ipcRenderer.invoke("providers:disconnect", provider),
  login: (provider: string, method: LoginMethod): Promise<LoginOutcome> =>
    ipcRenderer.invoke("providers:login", provider, method),
  answerLogin: (id: string, value: string): Promise<void> => ipcRenderer.invoke("providers:answer", id, value),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke("providers:cancel"),
  openLoginUrl: (url: string): Promise<void> => ipcRenderer.invoke("providers:open", url),
  onLoginStep: (listener: (step: LoginStep) => void): (() => void) => {
    const handler = (_e: unknown, step: LoginStep): void => listener(step);
    ipcRenderer.on("providers:step", handler);
    return () => void ipcRenderer.off("providers:step", handler);
  },
  providerUsage: (provider: string): Promise<ProviderUsage> => ipcRenderer.invoke("usage:get", provider),
  openUsagePage: (provider: string): Promise<void> => ipcRenderer.invoke("usage:open", provider),
  setUnseenCount: (count: number): Promise<void> => ipcRenderer.invoke("app:unseen", count),
  menu: <Id extends string>(items: { id: Id; label: string }[]): Promise<Id | undefined> =>
    ipcRenderer.invoke("menu:popup", items),
  renameSession: (agentId: string, session: string, name: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:rename", agentId, session, name),
  deleteSession: (agentId: string, session: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:delete", agentId, session),
  openSession: (
    agentId: string,
    session: string,
    subscription: string,
  ): Promise<{ state: SessionState; entries: SessionEntries }> =>
    ipcRenderer.invoke("session:open", agentId, session, subscription),
  readState: (agentId: string, session: string): Promise<SessionState> =>
    ipcRenderer.invoke("session:state", agentId, session),
  closeSession: (subscription: string): Promise<void> => ipcRenderer.invoke("session:close", subscription),
  readSession: (agentId: string, session: string): Promise<SessionEntries> =>
    ipcRenderer.invoke("session:entries", agentId, session),
  send: (agentId: string, session: string, text: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:send", agentId, session, text),
  abort: (agentId: string, session: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:abort", agentId, session),
  onOpenSettings: (listener: () => void): (() => void) => {
    const handler = (): void => listener();
    ipcRenderer.on("app:settings", handler);
    // A request made before this listener existed (⌘, with no window open) is held by main.
    void ipcRenderer.invoke("app:settingsPending").then((pending: boolean) => pending && listener());
    return () => void ipcRenderer.off("app:settings", handler);
  },
  onSessionEvent: (listener: (frame: SessionFrame) => void): (() => void) => {
    const handler = (_e: unknown, frame: SessionFrame): void => listener(frame);
    ipcRenderer.on("session:event", handler);
    return () => void ipcRenderer.off("session:event", handler);
  },
};

export type DuangApi = typeof api;

contextBridge.exposeInMainWorld("duang", api);
