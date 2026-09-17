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
  type AgentRow,
} from "./agents.ts";
import { credentials } from "./credentials.ts";
import { useSystemProxy } from "./proxy.ts";
import { NO_ACTIVE_RUN_CODE, NO_SUCH_SESSION_CODE, type SessionEvent } from "@fastagent-sh/fastagent/session";

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

  /**
   * Opening an agent is where everything that can be wrong about it shows up, so this answers with a
   * reason instead of rejecting: the UI asks for a model when one is missing, and reports the rest.
   */
  ipcMain.handle("agent:open", async (_e, agentId: string) => {
    try {
      const { control } = await openAgent(await requireAgent(agentId));
      return { ok: true as const, sessions: await control.sessions.list() };
    } catch (error) {
      const code =
        error instanceof MissingModelError ? "missing_model" : error instanceof NoAgentError ? "no_agent" : "failed";
      return { ok: false as const, code, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("agent:scaffold", async (_e, agentId: string) => createAgentIn((await requireAgent(agentId)).dir));

  /**
   * Two places hold a model, so both are set: the stored row decides what a REBUILT assembly and any
   * future session start on, and `update({ model })` moves the conversation that is open right now
   * without rebuilding anything. A conversation nobody has spoken in yet has no record to update —
   * `no_such_session` is the expected answer there, and the row already covers it.
   */
  ipcMain.handle("agent:setModel", async (_e, agentId: string, model: string, session?: string) => {
    await setAgentModel(agentId, model);
    const { control } = await openAgent(await requireAgent(agentId));
    if (!session) return;
    const result = await control.sessions.get(session).update({ model });
    if (!result.ok && result.error.code !== NO_SUCH_SESSION_CODE) throw new Error(result.error.message);
  });

  ipcMain.handle("agent:remove", (_e, agentId: string) => removeAgent(agentId));

  ipcMain.handle("agent:commands", async (_e, agentId: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    return control.commands();
  });

  ipcMain.handle("agent:reveal", async (_e, agentId: string) => {
    shell.showItemInFolder((await requireAgent(agentId)).dir);
  });

  ipcMain.handle("session:delete", async (_e, agentId: string, session: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    streams.get(`${agentId}/${session}`)?.();
    return control.sessions.get(session).delete();
  });

  ipcMain.handle("models:list", async () => (await credentials()).specs);

  ipcMain.handle("session:open", async (e, agentId: string, session: string) => {
    const { control } = await openAgent(await requireAgent(agentId));
    const bound = control.sessions.get(session);

    streams.get(`${agentId}/${session}`)?.();
    const stream = bound.events();
    const iterator = stream[Symbol.asyncIterator]();
    streams.set(`${agentId}/${session}`, () => void iterator.return?.());

    // Subscribe → await ready → backfill. Live-only events (`state_changed`, `run_settled`) have no
    // cursor, so anything landing between the read and the subscription would be gone for good; a
    // stream is only subscribed once something pulls it, and `ready` is that moment made waitable.
    void (async () => {
      try {
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
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
    await stream.ready;

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

void app.whenReady().then(async () => {
  await useSystemProxy();
  register();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
