import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import {
  addAgent,
  createAgentIn,
  listAgents,
  MissingModelError,
  NoAgentError,
  openAgent,
  refuse,
  registryFile,
  removeAgent,
  setAgentModel,
  withAgentRun,
  workingAgents,
  type AgentRow,
} from "./agents.ts";
import { credentials } from "./credentials.ts";
import { providerUsage } from "./usage.ts";
import { useSystemProxy } from "./proxy.ts";
import { rememberBounds, savedBounds } from "./window-state.ts";
import { send } from "./send.ts";
import { isAddressableSession, type SessionEvent } from "@fastagent-sh/fastagent/session";
import type { SessionFrame } from "../preload/index.ts";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 800,
    minHeight: 540,
    titleBarStyle: "hiddenInset",
    // Roughly macOS's own inset, a little tighter to the top than centring them in the sidebar's
    // header row would put them: with the panel starting 8 below the window edge, centring reads as
    // a gap above the buttons rather than as alignment.
    trafficLightPosition: { x: 18, y: 18 },
    // No vibrancy: every surface in this window is opaque (docs/ui.md §4), so a transparent window
    // over a native material had nothing to show through it and only cost a translucent first
    // paint. The background matches the canvas the renderer paints, so launching does not flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#fcfcfc",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  rememberBounds(win);
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

/**
 * These throw on purpose: a renderer asking about an agent that is not in the registry, or naming an
 * unaddressable session, is a bug in this app, not a choice the person can revisit. Refusals the
 * person CAN act on are returned as values instead — see `refuse`.
 */
async function requireAgent(agentId: string): Promise<AgentRow> {
  const row = (await listAgents()).find((a) => a.id === agentId);
  if (!row) throw new Error(`unknown agent ${agentId}`);
  return row;
}

function requireSession(session: string): void {
  if (typeof session !== "string" || !isAddressableSession(session)) throw new Error("Invalid session id");
}

type Stream = {
  senderId: number;
  agentId: string;
  close: () => void;
  end: (reason: string, expected: boolean) => void;
};
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
      stream.end(reason, true);
      stopStream(key);
    }
}

function register(): void {
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:add", async () => {
    // createDirectory: the project you want an agent in may not exist yet, and macOS hides New Folder
    // unless it is asked for.
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
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
    if (typeof model !== "string") throw new Error("Model must be a string");
    if (session !== undefined) requireSession(session);
    const row = await requireAgent(id);
    // The picker only offers configured models, so a miss here means the file changed underneath it.
    if (!(await credentials()).specs.includes(model))
      return refuse("model_unavailable", `${model} is not in the configured credential file — pick another.`);
    const result = await setAgentModel(row, model, session);
    if (result.ok) stopAgentStreams(id, "The agent's runtime was rebuilt for the new model");
    return result;
  });
  ipcMain.handle("agent:remove", async (_e, id: string) => {
    const result = await removeAgent(id);
    if (result.ok) stopAgentStreams(id, "The agent was removed");
    return result;
  });
  ipcMain.handle("agent:commands", async (_e, id: string) =>
    (await openAgent(await requireAgent(id))).control.commands(),
  );
  ipcMain.handle("agent:reveal", async (_e, id: string) => shell.showItemInFolder((await requireAgent(id)).dir));
  ipcMain.handle("registry:reveal", () => shell.showItemInFolder(registryFile));
  ipcMain.handle("models:list", credentials);
  ipcMain.handle("usage:get", (_e, provider: string) => {
    if (typeof provider !== "string" || !provider) throw new Error("Provider must be a non-empty string");
    return providerUsage(provider);
  });
  // The dock is where "something happened while you were away" belongs: the sidebar can only say it
  // while duang is the window you are looking at.
  ipcMain.handle("app:unseen", (_e, count: number) => {
    if (!Number.isInteger(count) || count < 0) throw new Error(`Unseen count must be a non-negative integer: ${count}`);
    app.setBadgeCount(count);
  });

  /**
   * The conversation row's context menu, which is macOS's own place for Rename: a native menu, so
   * it looks like the system's and not like one of our popovers. Chromium raises `contextmenu` for
   * Shift+F10 and the Menu key too, so this is the keyboard path as well.
   */
  ipcMain.handle("session:menu", async (event, canRename: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<string | undefined>((resolve) => {
      const menu = Menu.buildFromTemplate([
        ...(canRename ? [{ label: "Rename…", click: () => resolve("rename") }] : []),
        { label: "Delete Conversation", click: () => resolve("delete") },
      ]);
      menu.popup({ window: win, callback: () => resolve(undefined) });
    });
  });
  ipcMain.handle("session:rename", async (_e, id: string, session: string, name: string) => {
    requireSession(session);
    if (typeof name !== "string" || !name.trim()) throw new Error("A conversation name cannot be empty");
    const { control } = await openAgent(await requireAgent(id));
    // FastAgent owns the label: `update({ name })` is what `sessions.list()` then reports.
    return control.sessions.get(session).update({ name: name.trim() });
  });
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
    const post = (frame: Omit<SessionFrame, "agentId" | "session" | "subscription">) => {
      if (!e.sender.isDestroyed() && streams.get(key) === slot) {
        e.sender.send("session:event", { agentId: id, session, subscription, ...frame });
      }
    };
    const forward = (event: SessionEvent) => post({ event });
    slot.end = (reason, expected) => post({ ended: { reason, expected } });
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
        // `done`, and a silent one would keep the conversation running on screen forever. Only the
        // throw is a failure; a clean `done` is the runtime letting this subscriber go.
        let ending = { reason: "This conversation stopped receiving updates", expected: true };
        try {
          for (let next = await iterator.next(); !next.done; next = await iterator.next()) forward(next.value);
        } catch (error) {
          ending = { reason: String(error), expected: false };
        }
        slot.end(ending.reason, ending.expected);
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

/**
 * Closing a window leaves runs alone — they live here, not in the renderer. Quitting ends them, and
 * nothing resumes them afterwards, so it is the one moment worth interrupting.
 *
 * Not covered by an automated check: this is a native modal on the quit path, which the Electron
 * smoke test cannot answer without hanging. Verified by hand — quit during a run warns, Cancel keeps
 * the run going, Quit anyway exits; quitting while idle is unchanged.
 */
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || workingAgents().length === 0) return;
  event.preventDefault();
  const quit = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Quit anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "An agent is still working.",
    detail:
      "Quitting interrupts the run, and nothing resumes it afterwards. Work its tools already finished is not undone.",
  });
  if (quit === 0) {
    quitting = true;
    app.quit();
  }
});
