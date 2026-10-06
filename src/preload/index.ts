/** The renderer's whole privilege: these calls, nothing else. Written by hand so the shape is typed. */
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
  /**
   * `model`: the agent's default, for conversations that have none of their own; an agent may have none.
   * `staleDefault`: the default model duang keeps for it is one pi does not know, so it opened without it.
   */
  | { ok: true; sessions: SessionSummary[]; model?: string; staleDefault?: string }
  | {
      ok: false;
      code: "no_agent" | "missing_dir" | "broken";
      message: string;
      /** The failure is in the agent's config, or a file it imports: a fresh config gets past it. */
      inConfig?: true;
    };

/** One channel for every subscription of this window: each frame says which one it belongs to. */
export type SessionFrame = Frame<SessionEvent>;

const api = {
  listAgents: (): Promise<AgentRow[]> => ipcRenderer.invoke("agents:list"),
  addAgent: (): Promise<AgentRow | undefined> => ipcRenderer.invoke("agents:add"),
  openAgent: (agentId: string): Promise<OpenResult> => ipcRenderer.invoke("agent:open", agentId),
  /**
   * Sets the agent's model, and moves the named conversation onto it straight away. Refuses — as a
   * value — while any of the agent's conversations is running, or if the model is not configured.
   */
  setModel: (agentId: string, model: string, session?: string): Promise<SessionResult> =>
    ipcRenderer.invoke("agent:setModel", agentId, model, session),
  /**
   * Sets how hard the conversation's model thinks, one of the levels its `state()` lists. Refused, as a
   * value, while the conversation runs or if its model does not support the level.
   */
  setThinking: (agentId: string, session: string, level: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:setThinking", agentId, session, level),
  /** The roster's name for the agent. duang's label only; the directory keeps its name. */
  renameAgent: (agentId: string, name: string): Promise<void> => ipcRenderer.invoke("agent:rename", agentId, name),
  /** Forgets duang's row. Refuses while a conversation is running; the directory is never touched. */
  removeAgent: (agentId: string): Promise<SessionResult> => ipcRenderer.invoke("agent:remove", agentId),
  /**
   * Asks where the agent's moved folder is now and points the agent there, keeping its name, colour and
   * conversations. Undefined when the person cancels; refused while it runs or if another agent is there.
   */
  relocateAgent: (agentId: string): Promise<SessionResult | undefined> => ipcRenderer.invoke("agent:relocate", agentId),
  /** Replaces the config the agent failed to load in with a fresh one; a copy of the old one stays beside it. */
  resetAgentConfig: (agentId: string): Promise<SessionResult> => ipcRenderer.invoke("agent:resetConfig", agentId),
  /** Give a plain project an agent directory. Returns where it was created. */
  scaffoldAgent: (agentId: string): Promise<string> => ipcRenderer.invoke("agent:scaffold", agentId),
  /** The names this agent exposes — what the composer's `/` completion lists. */
  listCommands: (agentId: string): Promise<AgentCommand[]> => ipcRenderer.invoke("agent:commands", agentId),
  revealAgent: (agentId: string): Promise<void> => ipcRenderer.invoke("agent:reveal", agentId),
  /** Where duang keeps its agent list — the one thing to open when that file cannot be read. */
  revealRegistry: (): Promise<void> => ipcRenderer.invoke("registry:reveal"),
  /**
   * What this agent can run: built-ins and the `models.json` endpoints, kept to providers with a
   * configured credential (the credential file, an environment variable or a key in `models.json`).
   */
  listModels: (agentId: string): Promise<Models> => ipcRenderer.invoke("models:list", agentId),
  /**
   * Fetches models released after the bundled catalog and saves them in `models-store.json` in the
   * agent's folder, then answers with the new list. Only on request; rejects with FastAgent's reason.
   */
  refreshModels: (agentId: string): Promise<Models> => ipcRenderer.invoke("models:refresh", agentId),
  /** duang's own preferences, from the settings file. Rejects when it is unreadable. */
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  /** The route requests take now, as Chromium answers it. */
  getRoute: (): Promise<Route> => ipcRenderer.invoke("network:route"),
  /** Saves how avatars are drawn. Rejects when the settings file is unreadable, leaving it as it was. */
  setAvatar: (style: AvatarStyle): Promise<void> => ipcRenderer.invoke("settings:setAvatar", style),
  /** Saves and applies at once; new requests use it, a running turn keeps its connection. */
  setNetwork: (network: Network): Promise<Route> => ipcRenderer.invoke("settings:setNetwork", network),
  revealSettings: (): Promise<void> => ipcRenderer.invoke("settings:reveal"),
  /** One request over the model route: any HTTP status means it works; a failure names the route. */
  testNetwork: (): Promise<ConnectionCheck> => ipcRenderer.invoke("network:test"),
  /** What can be connected, and what serves each provider now. Rejects when duang's file is unreadable. */
  listProviders: (): Promise<ProviderRow[]> => ipcRenderer.invoke("providers:list"),
  /** Shows duang's credential file, or its folder before anything is connected. */
  revealProviders: (): Promise<void> => ipcRenderer.invoke("providers:reveal"),
  /** Removes the provider from duang's file only; an environment variable keeps serving it. */
  disconnect: (provider: string): Promise<void> => ipcRenderer.invoke("providers:disconnect", provider),
  /**
   * Runs one sign-in to the end. Its questions and progress arrive through `onLoginStep`, and are
   * answered with `answerLogin`. Cancelling resolves `{ ok: false, cancelled: true }`.
   */
  login: (provider: string, method: LoginMethod): Promise<LoginOutcome> =>
    ipcRenderer.invoke("providers:login", provider, method),
  answerLogin: (id: string, value: string): Promise<void> => ipcRenderer.invoke("providers:answer", id, value),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke("providers:cancel"),
  /** Opens again, in the system browser, a URL the sign-in in progress reported. */
  openLoginUrl: (url: string): Promise<void> => ipcRenderer.invoke("providers:open", url),
  onLoginStep: (listener: (step: LoginStep) => void): (() => void) => {
    const handler = (_e: unknown, step: LoginStep): void => listener(step);
    ipcRenderer.on("providers:step", handler);
    return () => void ipcRenderer.off("providers:step", handler);
  },
  /** A subscription's plan windows for this provider; no `windows` when its login is not a subscription. */
  providerUsage: (provider: string): Promise<ProviderUsage> => ipcRenderer.invoke("usage:get", provider),
  /** Opens the provider's own usage page in the browser, for a plan whose usage answered `page`. */
  openUsagePage: (provider: string): Promise<void> => ipcRenderer.invoke("usage:open", provider),
  /**
   * How many finished runs nobody has looked at. The dock is where "something happened while you
   * were away" belongs: the sidebar can only say it while duang is the window you are in.
   */
  setUnseenCount: (count: number): Promise<void> => ipcRenderer.invoke("app:unseen", count),
  /**
   * Opens a row's context menu and resolves with the chosen item's id, or undefined if the menu was
   * dismissed. Native, because Rename belongs in the system's own menu on macOS.
   */
  menu: <Id extends string>(items: { id: Id; label: string }[]): Promise<Id | undefined> =>
    ipcRenderer.invoke("menu:popup", items),
  /**
   * Names a conversation. Until this is called a list row falls back to the first message, which is
   * why a conversation whose subject moved on keeps the sentence it started with.
   */
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
  /** The conversation's state as the runtime reports it now, without a subscription. */
  readState: (agentId: string, session: string): Promise<SessionState> =>
    ipcRenderer.invoke("session:state", agentId, session),
  closeSession: (subscription: string): Promise<void> => ipcRenderer.invoke("session:close", subscription),
  /** A conversation's history, read once with no subscription: what a roster row quotes. */
  readSession: (agentId: string, session: string): Promise<SessionEntries> =>
    ipcRenderer.invoke("session:entries", agentId, session),
  /** Say this here. Steering a live run or starting a new one is decided in main, against the runtime. */
  send: (agentId: string, session: string, text: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:send", agentId, session, text),
  abort: (agentId: string, session: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:abort", agentId, session),
  /** The App menu's Settings… (⌘,): main owns the shortcut, the renderer owns where the page is. */
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
