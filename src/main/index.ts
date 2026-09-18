import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import {
  addAgent,
  createAgentIn,
  listAgents,
  MissingModelError,
  NoAgentError,
  openAgent,
  removeAgent,
  setAgentModel,
  withAgentRun,
  type AgentRow,
} from "./agents.ts";
import { credentials } from "./credentials.ts";
import { useSystemProxy } from "./proxy.ts";
import { send } from "./send.ts";
import { isAddressableSession, type SessionEvent } from "@fastagent-sh/fastagent/session";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 800,
    minHeight: 540,
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Model-generated links must never navigate a privileged renderer to another origin.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const senderId = win.webContents.id;
  win.webContents.on("destroyed", () => stopWindowStreams(senderId));
  win.webContents.on("did-start-loading", () => stopWindowStreams(senderId));
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return win;
}

async function requireAgent(agentId: string): Promise<AgentRow> {
  const row = (await listAgents()).find((a) => a.id === agentId);
  if (!row) throw new Error(`unknown agent ${agentId}`);
  return row;
}

function requireSession(session: string): void {
  if (typeof session !== "string" || !isAddressableSession(session)) throw new Error("Invalid session id");
}

type Stream = { senderId: number; agentId: string; close: () => void; end: (reason: string) => void };
// The renderer retains background subscriptions only while their turns are running.
const streams = new Map<string, Stream>();
function stopStream(key: string): void {
  const stream = streams.get(key);
  streams.delete(key);
  stream?.close();
}
function stopWindowStreams(senderId: number): void {
  for (const [key, stream] of streams) if (stream.senderId === senderId) stopStream(key);
}
/** Cutting an agent's subscriptions is invisible to the renderer unless each one says why it ended. */
function stopAgentStreams(agentId: string, reason: string): void {
  for (const [key, stream] of streams)
    if (stream.agentId === agentId) {
      stream.end(reason);
      stopStream(key);
    }
}

function register(): void {
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:add", async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!picked.canceled && picked.filePaths[0]) return addAgent(picked.filePaths[0]);
  });
  ipcMain.handle("agent:open", async (_e, agentId: string) => {
    try {
      const { control, modelSpec } = await openAgent(await requireAgent(agentId));
      return { ok: true, sessions: await control.sessions.list(), model: modelSpec };
    } catch (error) {
      const code =
        error instanceof MissingModelError ? "missing_model" : error instanceof NoAgentError ? "no_agent" : "failed";
      return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("agent:scaffold", async (_e, id: string) => createAgentIn((await requireAgent(id)).dir));
  ipcMain.handle("agent:setModel", async (_e, id: string, model: string, session?: string) => {
    if (typeof model !== "string" || !(await credentials()).specs.includes(model))
      throw new Error("Choose an available model");
    if (session !== undefined) requireSession(session);
    await setAgentModel(await requireAgent(id), model, session);
    stopAgentStreams(id, "The agent's runtime was rebuilt for the new model");
  });
  ipcMain.handle("agent:remove", async (_e, id: string) => {
    await removeAgent(id);
    stopAgentStreams(id, "The agent was removed");
  });
  ipcMain.handle("agent:commands", async (_e, id: string) =>
    (await openAgent(await requireAgent(id))).control.commands(),
  );
  ipcMain.handle("agent:reveal", async (_e, id: string) => shell.showItemInFolder((await requireAgent(id)).dir));
  ipcMain.handle("models:list", credentials);

  ipcMain.handle("session:delete", async (_e, id: string, session: string) => {
    requireSession(session);
    const { control } = await openAgent(await requireAgent(id));
    // A refused delete must leave the live subscription intact.
    return control.sessions.get(session).delete();
  });
  ipcMain.handle("session:close", (e, subscription: string) => stopStream(`${e.sender.id}/${subscription}`));
  ipcMain.handle("session:open", async (e, id: string, session: string, subscription: string) => {
    requireSession(session);
    const key = `${e.sender.id}/${subscription}`;
    stopStream(key);
    const slot: Stream = { senderId: e.sender.id, agentId: id, close: () => {}, end: () => {} };
    streams.set(key, slot);
    const forward = (event: SessionEvent) => {
      if (!e.sender.isDestroyed() && streams.get(key) === slot) {
        e.sender.send("session:event", { agentId: id, session, subscription, event });
      }
    };
    slot.end = (reason: string) => forward({ type: "stream_failed", timestamp: Date.now(), data: { reason } });
    try {
      const bound = (await openAgent(await requireAgent(id))).control.sessions.get(session);
      if (streams.get(key) !== slot) throw new Error("Conversation open was superseded");
      const stream = bound.events();
      const iterator = stream[Symbol.asyncIterator]();
      slot.close = () => {
        void iterator.return?.().catch((error) => console.error("session close:", error));
      };
      void (async () => {
        // Both endings leave the renderer deaf: FastAgent closing its subscriber looks like a normal
        // `done`, and a silent one would keep the conversation running on screen forever.
        let reason = "The conversation's event stream ended";
        try {
          for (let next = await iterator.next(); !next.done; next = await iterator.next()) forward(next.value);
        } catch (error) {
          reason = String(error);
        }
        slot.end(reason);
        if (streams.get(key) === slot) streams.delete(key);
      })();
      await stream.ready;
      return { entries: await bound.entries(), state: await bound.state() };
    } catch (error) {
      if (streams.get(key) === slot) stopStream(key);
      throw error;
    }
  });
  ipcMain.handle("session:send", async (_e: IpcMainInvokeEvent, id: string, session: string, text: string) => {
    requireSession(session);
    if (typeof text !== "string" || !text.trim()) throw new Error("Message must not be empty");
    // One credential file serves every runtime, so no conversation can name a model this agent
    // cannot authenticate: the picker only ever offered what that file has.
    return withAgentRun(await requireAgent(id), ({ agent, control }) =>
      send(agent, control.sessions.get(session), text),
    );
  });
  ipcMain.handle("session:abort", async (_e, id: string, session: string) => {
    requireSession(session);
    return (await openAgent(await requireAgent(id))).control.sessions.get(session).abort();
  });
}

void app
  .whenReady()
  .then(async () => {
    await useSystemProxy();
    register();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    dialog.showErrorBox("duang could not start", String(error));
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
