// Opt-in (`DUANG_LIVE=1`): real providers, this machine's duang credential file, a few tokens. `auth.json` is a
// symlink, never a copy: a copied OAuth login breaks when either refreshes. Quit duang first: two locks, one file.
import assert from "node:assert/strict";
import { existsSync, symlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { isolated } from "./harness.mjs";

const ASK = "Reply with exactly: OK";

if (!process.versions.electron && process.env.DUANG_LIVE !== "1") {
  console.log("Skipped: set DUANG_LIVE=1 to spend real model credits against the real credential file.");
  process.exit(0);
}
// The real HOME: the credential file this check links to is the developer's own.
const root = await isolated(import.meta.url, { name: "live", timeout: 300000, home: false });
if (root) {
  const { app } = electron;
  const data = join(root, "user-data");
  const dir = join(root, "agent");
  app.setPath("userData", data);

  let win;
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const call = (name, ...args) =>
    evaluate(`window.duang.${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  /** The assistant's own words, so a "success" with no answer cannot pass. */
  async function reply(session) {
    const subscription = `live-${session}`;
    const opened = await call("openSession", "live", session, subscription);
    await call("closeSession", subscription);
    const text = opened.entries.entries
      .filter((entry) => entry.kind === "assistant")
      .map((entry) => entry.data.text ?? "")
      .join("")
      .trim();
    return { text, model: opened.state.model };
  }

  async function run() {
    await mkdir(join(dir, "fastagent"), { recursive: true });
    await mkdir(data, { recursive: true });
    await writeFile(join(dir, "fastagent", "fastagent.config.ts"), "export default {};\n");
    await writeFile(join(data, "agents.json"), JSON.stringify([{ id: "live", name: "Live", dir, colour: 0 }]));
    // The app's own data directory, named explicitly: this process is "Electron", not "duang".
    const real = join(app.getPath("appData"), "duang", "auth.json");
    assert.ok(
      existsSync(real),
      `${real} does not exist. Sign in with ChatGPT (OpenAI) and connect Anthropic in duang (Settings → Model providers), or ` +
        `sign in with the CLI pointed at it: FASTAGENT_AUTH_PATH="${real}" fastagent login`,
    );
    const authFile = join(data, "auth.json");
    symlinkSync(real, authFile);

    const loaded = new Promise((resolve) => {
      app.once("browser-window-created", (_event, window) => {
        win = window;
        win.webContents.once("did-finish-load", resolve);
      });
    });
    await import("../out/main/index.js");
    await loaded;

    const models = await call("listModels", "live");
    const before = await readFile(authFile, "utf8");
    // Not simply the first OpenAI spec: a ChatGPT account may not run every listed model (issue #5).
    const chatgpt = process.env.DUANG_LIVE_OPENAI ?? models.find(({ spec }) => spec === "openai/gpt-5.5")?.spec;
    const anthropic = models.find(({ spec }) => spec.startsWith("anthropic/claude-sonnet"))?.spec;
    assert.ok(chatgpt && anthropic, `needs OpenAI and Anthropic in ${authFile}, got ${models.map(({ spec }) => spec).join(", ")}`);
    console.log(`Credential file: ${authFile}\nUsing: ${chatgpt} + ${anthropic}`);

    // 1. Agent default (OpenAI) runs with the credentials already on this machine.
    assert.deepEqual(await call("setModel", "live", chatgpt), { ok: true });
    const first = crypto.randomUUID();
    const chatgptRun = await call("send", "live", first, ASK);
    if (chatgptRun.ok) {
      console.log(`OpenAI reply: ${JSON.stringify((await reply(first)).text)}`);
    } else {
      // A quota or entitlement refusal still proves the token resolved; a credential fault must not pass as one.
      assert.doesNotMatch(chatgptRun.error.message, /not configured|refresh|unauthor|invalid[_ ]api|401/i);
      console.log(`OpenAI credentials accepted, provider refused the run: ${chatgptRun.error.message}`);
    }

    // 2. A conversation moved to the other provider.
    const second = crypto.randomUUID();
    assert.deepEqual(await call("setModel", "live", anthropic, second), { ok: true });
    assert.deepEqual(await call("send", "live", second, ASK), { ok: true }, "Anthropic conversation send");

    // 3. Issue #5's reported case: agent default is OpenAI again, history stays Anthropic and runs.
    assert.deepEqual(await call("setModel", "live", chatgpt), { ok: true });
    assert.equal((await call("openAgent", "live")).model, chatgpt, "agent default is OpenAI");
    assert.deepEqual(await call("send", "live", second, "Reply with exactly: STILL OK"), { ok: true }, "history send");
    const history = await reply(second);
    assert.equal(history.model, anthropic, "the historical conversation kept its own model");
    assert.match(history.text, /STILL OK/i);
    console.log(`Anthropic history (${history.model}) reply: ${JSON.stringify(history.text)}`);

    // Refresh may legitimately rewrite tokens; it must stay a readable file with the same providers.
    const after = await readFile(authFile, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(after)).sort(), Object.keys(JSON.parse(before)).sort());
    console.log(`Credential file ${after === before ? "unchanged" : "rewritten by OAuth refresh"}, providers intact.`);
    console.log("Live check passed: real OpenAI default, real Anthropic history, one credential file.");
  }

  const timeout = setTimeout(() => {
    console.error("Live check timed out");
    app.exit(1);
  }, 280000);
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      clearTimeout(timeout);
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(process.exitCode ?? 0);
    });
}
