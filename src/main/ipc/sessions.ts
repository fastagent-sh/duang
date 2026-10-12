// Conversations: history, the live subscription each one has here, and the turns sent through it. This module
// owns that table and the in-flight sends, because quitting and a window's release need them too.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { isAddressableSession, type SessionEvent } from "@fastagent-sh/fastagent/session";
import { agentRow, openAgent, withAgentRun } from "../agents.ts";
import { subscriptions, type Listener } from "../follow.ts";
import { offered } from "../models.ts";
import { syncCommandProxy } from "../proxy.ts";
import { send, sends } from "../send.ts";
import type { SessionFrame } from "../../preload/index.ts";

/** These throw: an unaddressable session id is a bug in this app, not something a person can act on. */
export function requireSession(session: string): void {
  if (typeof session !== "string" || !isAddressableSession(session)) throw new Error("Invalid session id");
}

async function sessionOf(agentId: string, session: string) {
  requireSession(session);
  return (await openAgent(await agentRow(agentId))).control.sessions.get(session);
}

const sessions = subscriptions(sessionOf);
const inFlight = sends();

const listener = (sender: WebContents): Listener<SessionEvent> => ({
  id: sender.id,
  post: (frame: SessionFrame) => {
    if (!sender.isDestroyed()) sender.send("session:event", frame);
  },
});

/** A window that is closing or reloading keeps its runs; it just stops hearing them. */
export const closeWindow = (senderId: number) => sessions.closeWindow(senderId);
/** The agent's runtime was replaced, so every one of its subscriptions listens again on the new one. */
export const rebindAgent = (agentId: string) => sessions.rebindAgent(agentId);
/** Cutting an agent's subscriptions is invisible to the window unless each one says why it ended. */
export const endAgent = (agentId: string, reason: string) => sessions.endAgent(agentId, reason);

export const runsBusy = () => inFlight.busy();

/** Stops every run before a quit, and answers whether they all settled inside `within`. */
export const stopAllRuns = (within: number) =>
  inFlight.stopAll(async (agentId, session) => (await sessionOf(agentId, session)).abort(), within);

export function registerSessions(): void {
  ipcMain.handle("session:state", async (_e, id: string, session: string) => (await sessionOf(id, session)).state());
  ipcMain.handle("session:setThinking", async (_e, id: string, session: string, level: string) => {
    if (typeof level !== "string") throw new Error("Thinking level must be a string");
    return (await sessionOf(id, session)).update({ thinkingLevel: level });
  });
  ipcMain.handle("session:rename", async (_e, id: string, session: string, name: string) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("A conversation name cannot be empty");
    return (await sessionOf(id, session)).update({ name: name.trim() });
  });
  // A refused delete must leave the live subscription intact.
  ipcMain.handle("session:delete", async (_e, id: string, session: string) => (await sessionOf(id, session)).delete());
  ipcMain.handle("session:close", (e, subscription: string) => sessions.close(e.sender.id, subscription));
  ipcMain.handle("session:entries", async (_e, id: string, session: string) => (await sessionOf(id, session)).entries());
  ipcMain.handle("session:open", async (e, id: string, session: string, subscription: string) => {
    requireSession(session);
    const bound = await sessions.open(listener(e.sender), id, session, subscription);
    return { entries: await bound.entries(), state: await bound.state() };
  });
  ipcMain.handle("session:send", async (_e: IpcMainInvokeEvent, id: string, session: string, text: string) => {
    requireSession(session);
    if (typeof text !== "string" || !text.trim()) throw new Error("Message must not be empty");
    // Held before the first await: a Stop sent right after this message must find it.
    return inFlight.hold(id, session, async (stopped) => {
      // The agent's commands spawn during this run; they get the route as it is now.
      await syncCommandProxy();
      const row = await agentRow(id);
      return withAgentRun(row, ({ agent, control }) =>
        send(agent, control.sessions.get(session), text, stopped, (model) => offered(row.dir, model)),
      );
    });
  });
  ipcMain.handle("session:abort", async (_e, id: string, session: string) => {
    requireSession(session);
    return inFlight.stop(id, session, async () => (await sessionOf(id, session)).abort());
  });
}
