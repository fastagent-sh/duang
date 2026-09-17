import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { addAgent, listAgents, openAgent, type AgentRow } from "./agents.ts";
import { NO_ACTIVE_RUN_CODE, type SessionEvent } from "@fastagent-sh/fastagent/session";

/** `SESSION_BUSY_CODE` from FastAgent's agent.ts, which no export path re-exports (0.21.1). */
const SESSION_BUSY_CODE = "session_busy";

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

  /**
   * One verb for "say this here". Which call it becomes is policy, and it is ours: a place with one
   * human steers a live run instead of queueing behind it (FastAgent's own chat channels choose the
   * opposite, and `invoke-turn-kit.ts` is where they say so).
   *
   * The routing never trusts the state it read: a run can start or settle between the read and the
   * call. The runtime decides feasibility with two stable codes, and each one names its other door.
   */
  ipcMain.handle("session:send", async (e, agentId: string, session: string, text: string) => {
    const { agent, control } = await openAgent(await requireAgent(agentId));
    const bound = control.sessions.get(session);
    const note = (reason: string) =>
      forward(e.sender, agentId, session, { type: "send_failed", timestamp: Date.now(), data: { reason } });

    const startRun = async (): Promise<void> => {
      let first = true;
      for await (const event of agent.invoke({ session }, { text })) {
        // Only a FIRST-event busy is a fail-fast reject; later ones belong to a turn that did start.
        if (first && event.type === "failed" && event.code === SESSION_BUSY_CODE) {
          const steered = await bound.steer({ text });
          if (!steered.ok) note(steered.error.message);
          return;
        }
        first = false;
      }
    };

    try {
      if ((await bound.state()).status === "running") {
        const steered = await bound.steer({ text });
        if (steered.ok) return;
        // The run settled in between — start one. Any other refusal is the person's to see.
        if (steered.error.code !== NO_ACTIVE_RUN_CODE) return note(steered.error.message);
      }
      await startRun();
    } catch (error) {
      note(String(error));
    }
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
