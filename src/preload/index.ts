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

export type OpenResult =
  | { ok: true; sessions: SessionSummary[]; model: string }
  | { ok: false; code: "missing_model" | "no_agent" | "failed"; message: string };

/**
 * One channel, two kinds of news: what the runtime said, and the fact that main ended this
 * subscription. The second is duang's own lifecycle, not a session event, so it travels as itself
 * rather than as a synthetic failure.
 */
export type SessionFrame = { agentId: string; session: string; subscription: string } & (
  | { event: SessionEvent; ended?: never }
  | { event?: never; ended: { reason: string; expected: boolean } }
);

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
  /** Forgets duang's row. Refuses while a conversation is running; the directory is never touched. */
  removeAgent: (agentId: string): Promise<SessionResult> => ipcRenderer.invoke("agent:remove", agentId),
  /** Give a plain project an agent directory. Returns where it was created. */
  scaffoldAgent: (agentId: string): Promise<string> => ipcRenderer.invoke("agent:scaffold", agentId),
  /** The names this agent exposes — what the composer's `/` completion lists. */
  listCommands: (agentId: string): Promise<AgentCommand[]> => ipcRenderer.invoke("agent:commands", agentId),
  revealAgent: (agentId: string): Promise<void> => ipcRenderer.invoke("agent:reveal", agentId),
  /** Where duang keeps its agent list — the one thing to open when that file cannot be read. */
  revealRegistry: (): Promise<void> => ipcRenderer.invoke("registry:reveal"),
  /** What this agent can run: built-ins and its own `models.json`, as configured in the credential file. */
  listModels: (agentId: string): Promise<Models> => ipcRenderer.invoke("models:list", agentId),
  /**
   * How many finished runs nobody has looked at. The dock is where "something happened while you
   * were away" belongs: the sidebar can only say it while duang is the window you are in.
   */
  setUnseenCount: (count: number): Promise<void> => ipcRenderer.invoke("app:unseen", count),
  /**
   * Opens the conversation row's context menu and resolves with what was chosen, or undefined if
   * the menu was dismissed. Native, because Rename belongs in the system's own menu on macOS.
   */
  conversationMenu: (canRename: boolean): Promise<"rename" | "delete" | undefined> =>
    ipcRenderer.invoke("session:menu", canRename),
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
  closeSession: (subscription: string): Promise<void> => ipcRenderer.invoke("session:close", subscription),
  /** Say this here. Steering a live run or starting a new one is decided in main, against the runtime. */
  send: (agentId: string, session: string, text: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:send", agentId, session, text),
  abort: (agentId: string, session: string): Promise<SessionResult> =>
    ipcRenderer.invoke("session:abort", agentId, session),
  onSessionEvent: (listener: (frame: SessionFrame) => void): (() => void) => {
    const handler = (_e: unknown, frame: SessionFrame): void => listener(frame);
    ipcRenderer.on("session:event", handler);
    return () => void ipcRenderer.off("session:event", handler);
  },
};

export type DuangApi = typeof api;

contextBridge.exposeInMainWorld("duang", api);
