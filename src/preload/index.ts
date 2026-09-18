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
  /** Sets the agent's model, and moves the named conversation onto it straight away. */
  setModel: (agentId: string, model: string, session?: string): Promise<void> =>
    ipcRenderer.invoke("agent:setModel", agentId, model, session),
  removeAgent: (agentId: string): Promise<void> => ipcRenderer.invoke("agent:remove", agentId),
  /** Give a plain project an agent directory. Returns where it was created. */
  scaffoldAgent: (agentId: string): Promise<string> => ipcRenderer.invoke("agent:scaffold", agentId),
  /** The names this agent exposes — what the composer's `/` completion lists. */
  listCommands: (agentId: string): Promise<AgentCommand[]> => ipcRenderer.invoke("agent:commands", agentId),
  revealAgent: (agentId: string): Promise<void> => ipcRenderer.invoke("agent:reveal", agentId),
  listModels: (): Promise<{ specs: string[]; authPath: string }> => ipcRenderer.invoke("models:list"),
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
