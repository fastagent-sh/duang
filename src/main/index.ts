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
  refuse,
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
import { send, sends } from "./send.ts";
import { isAddressableSession, type SessionEvent } from "@fastagent-sh/fastagent/session";
import type { SessionFrame } from "../preload/index.ts";

const settings = new SettingsFile(join(app.getPath("userData"), "settings.json"));

/**
 * Settings asked for with no window open. A new window's listener registers after React's first
 * effects, which can be after `did-finish-load`, and a message sent to no listener is dropped — so
 * the request waits here until the renderer asks for it.
 */
let settingsPending = false;

/** Settings is a place in the window, so the menu item asks the renderer to go there. */
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

/**
 * macOS keeps app-level Settings in the App menu under ⌘, (HIG, The menu bar). Replacing Electron's
 * default menu replaces all of it, so the standard File, Edit, View and Window menus are rebuilt from
 * their roles — without Edit, ⌘C and ⌘V stop working in every text field.
 */
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

/**
 * The window's page. `fresh` opens it on a new conversation instead of the one it was left on (the
 * renderer reads `#fresh` once and drops it), for a window that crashed drawing that conversation.
 */
function load(win: BrowserWindow, fresh = false): void {
  if (process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${fresh ? "#fresh" : ""}`);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), fresh ? { hash: "fresh" } : {});
}

/** Crashes inside this span count toward the same loop: past `CRASH_LIMIT` of them, reloading is asked first. */
const CRASH_SPAN_MS = 60_000;
const CRASH_LIMIT = 2;
/** For the app, not one window: a window closed and opened again from the Dock starts no new count. */
const crashes: number[] = [];

/**
 * A renderer that crashes, or is killed, leaves the window blank with nothing to press. Its runs live here
 * and keep going, so the window is reloaded, which reopens what it showed. One that keeps crashing likely
 * draws something that crashes it again, and reloading would open that again: the person is asked, with
 * the reason, and the way on opens the window on a new conversation instead of the one it was showing.
 */
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

/** A conversation on its agent's current runtime, after checking both ids as above. */
async function sessionOf(agentId: string, session: string) {
  requireSession(session);
  return (await openAgent(await requireAgent(agentId))).control.sessions.get(session);
}

/** The one sign-in in progress, and the window it belongs to. */
let signIn: { senderId: number; flow: ReturnType<typeof startLogin> } | undefined;

/** Sends in main's hands, per conversation: a Stop before the run exists is answered here. */
const inFlight = sends();

const sessions = subscriptions(sessionOf);
/** A window as its subscriptions post to it: a window that has gone hears nothing. */
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
      const { control, modelSpec } = await openAgent(await requireAgent(agentId));
      return { ok: true, sessions: await control.sessions.list(), model: modelSpec };
    } catch (error) {
      const code = error instanceof NoAgentError ? "no_agent" : error instanceof MissingDirError ? "missing_dir" : "failed";
      const message = error instanceof Error ? error.message : String(error);
      return code === "failed" && configFailed(agentId) ? { ok: false, code, message, inConfig: true } : { ok: false, code, message };
    }
  });
  // The folder was moved: the person shows where it is now.
  ipcMain.handle("agent:relocate", async (_e, id: string) => {
    const row = await requireAgent(id);
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], message: `Where is "${row.name}" now?` });
    if (picked.canceled || !picked.filePaths[0]) return undefined;
    return relocateAgent(row.id, picked.filePaths[0]);
  });
  // The agent's config does not load: start a fresh one, keeping a copy of the old one. Main knows which file.
  ipcMain.handle("agent:resetConfig", async (_e, id: string) => resetAgentConfig(await requireAgent(id)));
  ipcMain.handle("agent:scaffold", async (_e, id: string) => createAgentIn((await requireAgent(id)).dir));
  ipcMain.handle("agent:setModel", async (_e, id: string, model: string, session?: string) => {
    if (typeof model !== "string") throw new Error("Model must be a string");
    if (session !== undefined) requireSession(session);
    const row = await requireAgent(id);
    // The picker offers this agent's runnable models, so a miss here means something changed underneath it.
    if (!(await modelsFor(row.dir)).some((offered) => offered.spec === model))
      return refuse("model_unavailable", `${model} is not available to this agent — pick another.`);
    const result = await setAgentModel(row, model, session);
    if (result.ok) await sessions.rebindAgent(id);
    return result;
  });
  ipcMain.handle("session:state", async (_e, id: string, session: string) => (await sessionOf(id, session)).state());
  ipcMain.handle("session:setThinking", async (_e, id: string, session: string, level: string) => {
    if (typeof level !== "string") throw new Error("Thinking level must be a string");
    // FastAgent checks the level against what this conversation's model supports, and refuses while it runs.
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
  // Read on every open of the page, and at start for the roster: a file fixed by hand shows up without a
  // restart, and a broken one is reported rather than shown as the defaults. The route is its own call:
  // it waits on Chromium's answer (a PAC script can be slow), which the roster must not.
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
  // Model providers, in duang's own credential file. `empty` is never written: it is where a provider's
  // environment variable is read with no stored credential in front of it. In this user's own data,
  // not a shared temporary directory where anyone could put a file at that path.
  const empty = join(app.getPath("userData"), "no-credentials.json");
  ipcMain.handle("providers:list", () => listProviders(authPath, empty));
  // Before anything is connected the file does not exist yet; its folder is the place to show.
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
    // One flow at a time: a second callback server, or a second masked field, would be ambiguous.
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
  // A plan whose usage only its provider's page shows: main opens its own address for that provider.
  ipcMain.handle("usage:open", (_e, provider: string) => {
    if (typeof provider !== "string") throw new Error("Provider must be a string");
    return shell.openExternal(usagePage(provider));
  });
  // The dock is where "something happened while you were away" belongs: the sidebar can only say it
  // while duang is the window you are looking at.
  ipcMain.handle("app:unseen", (_e, count: number) => {
    if (!Number.isInteger(count) || count < 0) throw new Error(`Unseen count must be a non-negative integer: ${count}`);
    app.setBadgeCount(count);
  });

  /**
   * A row's context menu, which is macOS's own place for Rename: a native menu, so it looks like the
   * system's and not like one of our popovers. Chromium raises `contextmenu` for Shift+F10 and the
   * Menu key too, so this is the keyboard path as well.
   */
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
    // FastAgent owns the label: `update({ name })` is what `sessions.list()` then reports.
    return (await sessionOf(id, session)).update({ name: name.trim() });
  });
  // A refused delete must leave the live subscription intact.
  ipcMain.handle("session:delete", async (_e, id: string, session: string) => (await sessionOf(id, session)).delete());
  ipcMain.handle("session:close", (e, subscription: string) => sessions.close(e.sender.id, subscription));
  // History without a subscription: what a roster row quotes from a conversation nobody has open.
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
      // One credential file serves every runtime, and a run starts only on a model the picker would offer.
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

// One duang per data directory: the installed app and `npm run dev` share it (Electron's userData), and two of them
// would write one agent registry with no lock between processes, and refresh one OAuth login twice. The second one
// shows the first and leaves.
if (!app.requestSingleInstanceLock()) {
  console.error(`duang is already running with ${app.getPath("userData")}; showing that one instead.`);
  app.exit(0);
} else
  app.on("second-instance", () => {
    // On macOS duang keeps running with its last window closed: then there is nothing to show but a new one.
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
      // The network still needs a route, and guessing someone's manual proxy is worse than the
      // system's. Said out loud, and again on the Settings page until the file is fixed.
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

/**
 * Closing a window leaves runs alone — they live here, not in the renderer. Quitting ends them, and
 * nothing resumes them afterwards, so it is the one moment worth interrupting. Quit anyway stops each
 * run as Stop does and waits, briefly, for it to settle: a run cut by the process ending records no
 * outcome at all, while a stopped one records that it was stopped.
 *
 * The native modal is not answered by the smoke test, which would hang on it; the stop-and-wait is
 * `sends().stopAll`, tested on its own.
 */
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
