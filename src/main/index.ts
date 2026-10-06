import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addAgent,
  createAgentIn,
  listAgents,
  MissingDirError,
  NoAgentError,
  openAgent,
  registryFile,
  relocateAgent,
  resetAgentConfig,
  configFailed,
  removeAgent,
  renameAgent,
  setAgentModel,
  withAgentRun,
  type AgentRow,
} from "./agents.ts";
import { authPath, modelsFor, refreshModels } from "./credentials.ts";
import { disconnect, listProviders, startLogin, type LoginMethod, type LoginOutcome } from "./providers.ts";
import { forgetUsage, providerUsage, usagePage } from "./usage.ts";
import { applyNetwork, describeRoute, syncCommandProxy, testConnection } from "./proxy.ts";
import { avatar, DEFAULTS, network, SettingsFile } from "./settings.ts";
import { rememberBounds, savedBounds } from "./window-state.ts";
import { subscriptions, type Listener } from "./follow.ts";
import { MODEL_UNAVAILABLE_CODE, refuse, send, sends } from "./send.ts";
import { isAddressableSession, type SessionEvent } from "@fastagent-sh/fastagent/session";
import type { SessionFrame } from "../preload/index.ts";

const settings = new SettingsFile(join(app.getPath("userData"), "settings.json"));

// A new window's listener can register after `did-finish-load`, and a message to no listener is dropped,
// so the request waits until the renderer asks.
let settingsPending = false;

function openSettings(): void {
  const existing = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (existing) {
    existing.show();
    existing.webContents.send("app:settings");
    return;
  }
  settingsPending = true;
  createWindow();
}

// Replacing Electron's default menu replaces all of it; without the Edit roles ⌘C and ⌘V stop working.
function setApplicationMenu(): void {
  if (process.platform !== "darwin") return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { id: "settings", label: "Settings…", accelerator: "Command+,", click: openSettings },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 800,
    minHeight: 540,
    titleBarStyle: "hiddenInset",
    // Tighter to the top than centring: with the panel 8 below the edge, centring reads as a gap above.
    trafficLightPosition: { x: 18, y: 18 },
    // No vibrancy: every surface is opaque. Matching the renderer's canvas avoids a flash at launch.
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
  // Closing or reloading the window (⌘R, a renderer crash) leaves nobody to answer its sign-in, so it
  // ends, which also closes the provider's callback server; the webContents id survives a reload.
  const release = () => {
    sessions.closeWindow(senderId);
    if (signIn?.senderId === senderId) signIn.flow.cancel();
  };
  win.webContents.on("destroyed", release);
  win.webContents.on("did-start-loading", release);
  reloadWhenGone(win);
  load(win);
  return win;
}

// `fresh` opens on a new conversation, for a window that crashed drawing the last one.
function load(win: BrowserWindow, fresh = false): void {
  if (process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${fresh ? "#fresh" : ""}`);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), fresh ? { hash: "fresh" } : {});
}

const CRASH_SPAN_MS = 60_000;
const CRASH_LIMIT = 2;
/** For the app, not one window: a window closed and opened again from the Dock starts no new count. */
const crashes: number[] = [];

// A crashed renderer leaves a blank window while its runs go on here, so reload. One that keeps crashing
// likely redraws what crashed it: ask first, and open on a new conversation.
function reloadWhenGone(win: BrowserWindow): void {
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    console.error(`duang: the window's renderer ended (${details.reason}, exit code ${details.exitCode})`);
    const now = Date.now();
    crashes.push(now);
    while (crashes[0]! < now - CRASH_SPAN_MS) crashes.shift();
    if (crashes.length <= CRASH_LIMIT) return win.webContents.reload();
    void dialog
      .showMessageBox(win, {
        type: "error",
        message: "duang's window keeps crashing.",
        detail: `It ended ${crashes.length} times in the last minute (${details.reason}). The conversation it was showing may be what crashes it, so it opens on a new conversation; that one stays in the list. Runs in progress keep going.`,
        buttons: ["Open on a New Conversation", "Close Window"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) load(win, true);
        else win.destroy();
      });
  });
}

// These throw: an unknown agent or unaddressable session is a bug in this app. Refusals a person can act on
// are values (`refuse`).
async function requireAgent(agentId: string): Promise<AgentRow> {
  const row = (await listAgents()).find((a) => a.id === agentId);
  if (!row) throw new Error(`unknown agent ${agentId}`);
  return row;
}

function requireSession(session: string): void {
  if (typeof session !== "string" || !isAddressableSession(session)) throw new Error("Invalid session id");
}

async function sessionOf(agentId: string, session: string) {
  requireSession(session);
  return (await openAgent(await requireAgent(agentId))).control.sessions.get(session);
}

let signIn: { senderId: number; flow: ReturnType<typeof startLogin> } | undefined;

// A Stop that arrives before the run exists is answered here.
const inFlight = sends();

const sessions = subscriptions(sessionOf);
const listener = (sender: WebContents): Listener<SessionEvent> => ({
  id: sender.id,
  post: (frame: SessionFrame) => {
    if (!sender.isDestroyed()) sender.send("session:event", frame);
  },
});

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
      const { control, modelSpec, staleDefault } = await openAgent(await requireAgent(agentId));
      return { ok: true, sessions: await control.sessions.list(), model: modelSpec, ...(staleDefault && { staleDefault }) };
    } catch (error) {
      const code = error instanceof NoAgentError ? "no_agent" : error instanceof MissingDirError ? "missing_dir" : "broken";
      const message = error instanceof Error ? error.message : String(error);
      return code === "broken" && configFailed(agentId) ? { ok: false, code, message, inConfig: true } : { ok: false, code, message };
    }
  });
  ipcMain.handle("agent:relocate", async (_e, id: string) => {
    const row = await requireAgent(id);
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], message: `Where is "${row.name}" now?` });
    if (picked.canceled || !picked.filePaths[0]) return undefined;
    return relocateAgent(row.id, picked.filePaths[0]);
  });
  ipcMain.handle("agent:resetConfig", async (_e, id: string) => resetAgentConfig(await requireAgent(id)));
  ipcMain.handle("agent:scaffold", async (_e, id: string) => createAgentIn((await requireAgent(id)).dir));
  ipcMain.handle("agent:setModel", async (_e, id: string, model: string, session?: string) => {
    if (typeof model !== "string") throw new Error("Model must be a string");
    if (session !== undefined) requireSession(session);
    const row = await requireAgent(id);
    if (!(await modelsFor(row.dir)).some((offered) => offered.spec === model))
      return refuse(MODEL_UNAVAILABLE_CODE, `${model} is not available to this agent — pick another.`);
    const result = await setAgentModel(row, model, session);
    if (result.ok) await sessions.rebindAgent(id);
    return result;
  });
  ipcMain.handle("session:state", async (_e, id: string, session: string) => (await sessionOf(id, session)).state());
  ipcMain.handle("session:setThinking", async (_e, id: string, session: string, level: string) => {
    if (typeof level !== "string") throw new Error("Thinking level must be a string");
    return (await sessionOf(id, session)).update({ thinkingLevel: level });
  });
  ipcMain.handle("agent:remove", async (_e, id: string) => {
    const result = await removeAgent(id);
    if (result.ok) sessions.endAgent(id, "The agent was removed");
    return result;
  });
  ipcMain.handle("agent:rename", async (_e, id: string, name: string) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("An agent name cannot be empty");
    await renameAgent((await requireAgent(id)).id, name.trim());
  });
  ipcMain.handle("agent:commands", async (_e, id: string) =>
    (await openAgent(await requireAgent(id))).control.commands(),
  );
  ipcMain.handle("agent:reveal", async (_e, id: string) => shell.showItemInFolder((await requireAgent(id)).dir));
  ipcMain.handle("registry:reveal", () => shell.showItemInFolder(registryFile));
  // Read on every open, so a file fixed by hand shows without a restart. The route is its own call: a PAC
  // script can be slow, and the roster must not wait on it.
  ipcMain.handle("settings:get", () => settings.read());
  ipcMain.handle("network:route", () => describeRoute());
  ipcMain.handle("settings:setAvatar", (_e, value: unknown) => settings.change({ avatar: avatar(value) }));
  ipcMain.handle("settings:setNetwork", (_e, value: unknown) => {
    const next = network(value);
    return settings.change({ network: next }, async () => {
      await applyNetwork(next);
      return describeRoute();
    });
  });
  ipcMain.handle("settings:reveal", () => shell.showItemInFolder(settings.path));
  ipcMain.handle("app:settingsPending", () => {
    const pending = settingsPending;
    settingsPending = false;
    return pending;
  });
  ipcMain.handle("network:test", () => testConnection());
  ipcMain.handle("models:list", async (_e, id: string) => modelsFor((await requireAgent(id)).dir));
  ipcMain.handle("models:refresh", async (_e, id: string) => refreshModels((await requireAgent(id)).dir));
  // `empty` is never written: reading it shows what env variables alone provide. In userData, not a shared tmp dir.
  const empty = join(app.getPath("userData"), "no-credentials.json");
  ipcMain.handle("providers:list", () => listProviders(authPath, empty));
  ipcMain.handle("providers:reveal", () =>
    existsSync(authPath) ? shell.showItemInFolder(authPath) : shell.openPath(dirname(authPath)),
  );
  ipcMain.handle("providers:disconnect", async (_e, provider: string) => {
    if (typeof provider !== "string" || !provider) throw new Error("Provider must be a non-empty string");
    await disconnect(authPath, provider);
    forgetUsage(provider, authPath);
  });
  ipcMain.handle("providers:login", async (e, provider: string, method: LoginMethod): Promise<LoginOutcome> => {
    if (typeof provider !== "string" || (method !== "oauth" && method !== "api_key"))
      throw new Error("A sign-in names a provider and oauth or api_key");
    if (signIn) return { ok: false, error: "Another sign-in is in progress." };
    const flow = startLogin({
      provider,
      method,
      authPath,
      send: (step) => {
        if (!e.sender.isDestroyed()) e.sender.send("providers:step", step);
      },
      open: (url) => shell.openExternal(url),
    });
    signIn = { senderId: e.sender.id, flow };
    try {
      const outcome = await flow.result;
      if (outcome.ok) forgetUsage(provider, authPath);
      return outcome;
    } finally {
      signIn = undefined;
    }
  });
  ipcMain.handle("providers:answer", (e, id: string, value: string) => {
    if (typeof id !== "string" || typeof value !== "string") throw new Error("An answer is a prompt id and a string");
    if (signIn?.senderId === e.sender.id) signIn.flow.answer(id, value);
  });
  ipcMain.handle("providers:cancel", (e) => {
    if (signIn?.senderId === e.sender.id) signIn.flow.cancel();
  });
  ipcMain.handle("providers:open", async (e, url: string) => {
    if (signIn?.senderId !== e.sender.id) throw new Error("No sign-in is in progress");
    await signIn.flow.reopen(url);
  });
  ipcMain.handle("usage:get", (_e, provider: string) => {
    if (typeof provider !== "string" || !provider) throw new Error("Provider must be a non-empty string");
    return providerUsage(provider, authPath);
  });
  ipcMain.handle("usage:open", (_e, provider: string) => {
    if (typeof provider !== "string") throw new Error("Provider must be a string");
    return shell.openExternal(usagePage(provider));
  });
  ipcMain.handle("app:unseen", (_e, count: number) => {
    if (!Number.isInteger(count) || count < 0) throw new Error(`Unseen count must be a non-negative integer: ${count}`);
    app.setBadgeCount(count);
  });

  // Native, so Rename looks like the system's. Chromium also raises `contextmenu` for Shift+F10 and the Menu key.
  ipcMain.handle("menu:popup", async (event, items: { id: string; label: string }[]) => {
    if (!Array.isArray(items) || items.some((item) => typeof item?.id !== "string" || typeof item.label !== "string"))
      throw new Error("Menu items must be { id, label } strings");
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return new Promise<string | undefined>((resolve) => {
      const menu = Menu.buildFromTemplate(items.map(({ id, label }) => ({ label, click: () => resolve(id) })));
      menu.popup({ window: win, callback: () => resolve(undefined) });
    });
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
    return inFlight.hold(`${id}/${session}`, async (stopped) => {
      // The agent's commands spawn during this run; they get the route as it is now.
      await syncCommandProxy();
      const row = await requireAgent(id);
      const offered = async (model: string) => (await modelsFor(row.dir)).some((m) => m.spec === model);
      return withAgentRun(row, ({ agent, control }) => send(agent, control.sessions.get(session), text, stopped, offered));
    });
  });
  ipcMain.handle("session:abort", async (_e, id: string, session: string) => {
    requireSession(session);
    return inFlight.stop(`${id}/${session}`, async () => (await sessionOf(id, session)).abort());
  });
}

// One duang per userData (the app and `npm run dev` share it): two would write one registry with no lock and
// refresh one OAuth login twice.
if (!app.requestSingleInstanceLock()) {
  console.error(`duang is already running with ${app.getPath("userData")}; showing that one instead.`);
  app.exit(0);
} else
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return void createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
  });

void app
  .whenReady()
  .then(async () => {
    let saved = DEFAULTS;
    try {
      saved = await settings.read();
    } catch (error) {
      // Guessing a manual proxy is worse than the system's; said here and on Settings until the file is fixed.
      dialog.showErrorBox(
        "duang could not read its settings",
        `${(error as Error).message}\n\nThe network follows the system proxy until the file is fixed or removed.`,
      );
    }
    await applyNetwork(saved.network);
    setApplicationMenu();
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

// Quitting ends runs and nothing resumes them, so ask. Quit anyway stops them as Stop does and waits briefly:
// a stopped run records its outcome, a cut one records nothing.
const QUIT_WAIT_MS = 5000;
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !inFlight.busy()) return;
  event.preventDefault();
  const quit = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Quit anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "An agent is still working.",
    detail:
      "Quitting stops the run, and nothing resumes it afterwards. Work its tools already finished is not undone.",
  });
  if (quit !== 0) return;
  // Quitting again while this waits quits at once.
  quitting = true;
  void inFlight
    .stopAll(async (key) => {
      const slash = key.indexOf("/");
      return (await sessionOf(key.slice(0, slash), key.slice(slash + 1))).abort();
    }, QUIT_WAIT_MS)
    .then((settled) => {
      if (!settled) console.error(`duang: a stopped run had not settled after ${QUIT_WAIT_MS} ms; quitting cuts it`);
      app.quit();
    });
});
