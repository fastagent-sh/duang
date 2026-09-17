import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { addAgent, listAgents, openAgent, type AgentRow } from "./agents.ts";
import type { SessionEvent } from "@fastagent-sh/fastagent/session";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    backgroundColor: "#00000000",
    webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return win;
}

async function requireAgent(agentId: string): Promise<AgentRow> {
  const row = (await listAgents()).find((a) => a.id === agentId);
  if (!row) throw new Error(`unknown agent ${agentId}`);
  return row;
}

/** One forwarding loop per open conversation, keyed so a re-subscribe replaces rather than doubles. */
const streams = new Map<string, () => void>();

function forward(sender: IpcMainInvokeEvent["sender"], agentId: string, session: string, event: SessionEvent): void {
  if (!sender.isDestroyed()) sender.send("session:event", { agentId, session, event });
}

function register(): void {
  ipcMain.handle("agents:list", () => listAgents());

  ipcMain.handle("agents:add", async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return undefined;
    return addAgent(picked.filePaths[0]);
  });

  ipcMain.handle("sessions:list", async (_e, agentId: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    return control.sessions.list();
  });

  ipcMain.handle("session:open", async (e, agentId: string, session: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    const bound = control.sessions.get(session);

    streams.get(`${agentId}/${session}`)?.();
    const iterator = bound.events()[Symbol.asyncIterator]();
    streams.set(`${agentId}/${session}`, () => void iterator.return?.());

    // Subscribe BEFORE backfilling, or a live-only event landing in between is lost. The first
    // `next()` is what registers the subscription, so it is pulled here and consumed by the loop.
    // ponytail: FastAgent is adding `events().ready` for exactly this; use it once it ships.
    const first = iterator.next();
    void (async () => {
      try {
        for (let next = await first; !next.done; next = await iterator.next()) {
          forward(e.sender, agentId, session, next.value);
        }
      } catch (error) {
        forward(e.sender, agentId, session, {
          type: "stream_failed",
          timestamp: Date.now(),
          data: { reason: String(error) },
        });
      }
    })();

    // Read back rather than assume: a session that does not exist yet answers with an empty one.
    return { state: await bound.state(), entries: await bound.entries() };
  });

  ipcMain.handle("session:prompt", async (e, agentId: string, session: string, text: string) => {
    const { agent } = await openAgent(await requireAgent(agentId));
    // The turn's events reach the UI through the control stream; this loop only drives it and
    // reports the failure the stream cannot (an invoke that never started a run).
    void (async () => {
      try {
        for await (const _ of agent.invoke({ session }, { text })) {
          // drained on purpose
        }
      } catch (error) {
        forward(e.sender, agentId, session, {
          type: "invoke_failed",
          timestamp: Date.now(),
          data: { reason: String(error) },
        });
      }
    })();
  });

  ipcMain.handle("session:steer", async (_e, agentId: string, session: string, text: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    return control.sessions.get(session).steer({ text });
  });

  ipcMain.handle("session:abort", async (_e, agentId: string, session: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    return control.sessions.get(session).abort();
  });
}

void app.whenReady().then(() => {
  register();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
