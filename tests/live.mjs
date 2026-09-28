/**
 * Real provider check for issue #5: no faked HTTP, this machine's own duang credential file.
 * Opt-in (`DUANG_LIVE=1`), spends a few model tokens, and prints no credential values.
 *
 * Isolated: a temporary userData/registry and a throwaway agent directory. NOT isolated on purpose:
 * the credential file. The temporary userData's `auth.json` is a symlink to the real one, never a copy:
 * a copied OAuth login is invalidated the first time either copy refreshes. Real refresh writes back
 * through the link, as it does in the app.
 *
 * Quit duang first. FastAgent locks the path it was given, so this run and a running app would hold
 * different locks over the same file and could refresh one login at once.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const ASK = "Reply with exactly: OK";

if (!process.versions.electron) {
  if (process.env.DUANG_LIVE !== "1") {
    console.log("Skipped: set DUANG_LIVE=1 to spend real model credits against the real credential file.");
    process.exit(0);
  }
  const root = mkdtempSync(join(tmpdir(), "duang-live-"));
  try {
    const child = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, DUANG_LIVE_ROOT: root },
      timeout: 300000,
    });
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const { app } = electron;
  const root = process.env.DUANG_LIVE_ROOT;
  assert.ok(root, "Run with node tests/live.mjs");
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
    await writeFile(join(data, "agents.json"), JSON.stringify([{ id: "live", name: "Live", dir }]));
    // The app's own data directory, named explicitly: this process is "Electron", not "duang".
    const real = join(app.getPath("appData"), "duang", "auth.json");
    assert.ok(
      existsSync(real),
      `${real} does not exist. Connect Codex and Anthropic in duang (Settings → Model providers), or ` +
        `sign in with the CLI pointed at it: FASTAGENT_AUTH_PATH="${real}" fastagent login`,
    );
    symlinkSync(real, join(data, "auth.json"));

    const loaded = new Promise((resolve) => {
      app.once("browser-window-created", (_event, window) => {
        win = window;
        win.webContents.once("did-finish-load", resolve);
      });
    });
    await import("../out/main/index.js");
    await loaded;

    const models = await call("listModels", "live");
    const before = await readFile(models.authPath, "utf8");
    // Not simply the first Codex spec: the picker also lists models a ChatGPT account may not run
    // (see the note in issue #5), and this check is about credentials, not entitlements.
    const codex = process.env.DUANG_LIVE_CODEX ?? models.specs.find((spec) => spec === "openai-codex/gpt-5.5");
    const anthropic = models.specs.find((spec) => spec.startsWith("anthropic/claude-sonnet"));
    assert.ok(codex && anthropic, `needs Codex and Anthropic in ${models.authPath}, got ${models.specs.join(", ")}`);
    console.log(`Credential file: ${models.authPath}\nUsing: ${codex} + ${anthropic}`);

    // 1. Agent default (Codex) runs with the credentials already on this machine.
    assert.deepEqual(await call("setModel", "live", codex), { ok: true });
    const first = crypto.randomUUID();
    const codexRun = await call("send", "live", first, ASK);
    if (codexRun.ok) {
      console.log(`Codex reply: ${JSON.stringify((await reply(first)).text)}`);
    } else {
      // A quota or entitlement refusal still proves the token resolved and the account was
      // recognised. A credential fault must not pass as one, so name those explicitly.
      assert.doesNotMatch(codexRun.error.message, /not configured|refresh|unauthor|invalid[_ ]api|401/i);
      console.log(`Codex credentials accepted, provider refused the run: ${codexRun.error.message}`);
    }

    // 2. A conversation moved to the other provider.
    const second = crypto.randomUUID();
    assert.deepEqual(await call("setModel", "live", anthropic, second), { ok: true });
    assert.deepEqual(await call("send", "live", second, ASK), { ok: true }, "Anthropic conversation send");

    // 3. Issue #5's reported case: agent default is Codex again, history stays Anthropic and runs.
    assert.deepEqual(await call("setModel", "live", codex), { ok: true });
    assert.equal((await call("openAgent", "live")).model, codex, "agent default is Codex");
    assert.deepEqual(await call("send", "live", second, "Reply with exactly: STILL OK"), { ok: true }, "history send");
    const history = await reply(second);
    assert.equal(history.model, anthropic, "the historical conversation kept its own model");
    assert.match(history.text, /STILL OK/i);
    console.log(`Anthropic history (${history.model}) reply: ${JSON.stringify(history.text)}`);

    // Refresh may legitimately rewrite tokens; it must stay a readable file with the same providers.
    const after = await readFile(models.authPath, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(after)).sort(), Object.keys(JSON.parse(before)).sort());
    console.log(`Credential file ${after === before ? "unchanged" : "rewritten by OAuth refresh"}, providers intact.`);
    console.log("Live check passed: real Codex default, real Anthropic history, one credential file.");
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
