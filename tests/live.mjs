// Opt-in (`DUANG_LIVE=1`): real providers, this machine's duang credential file, a few tokens. `auth.json` is a
// symlink, never a copy: a copied OAuth login breaks when either refreshes. Quit duang first: two locks, one file.
import assert from "node:assert/strict";
import { existsSync, symlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { isolated } from "./harness.mjs";
import { open, windowDriver } from "./window.mjs";

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
  let evaluate;
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
      `${real} does not exist. Connect the providers to check in duang (Settings → Model providers), or ` +
        `sign in with the CLI pointed at it: FASTAGENT_AUTH_PATH="${real}" fastagent login`,
    );
    const authFile = join(data, "auth.json");
    symlinkSync(real, authFile);

    win = await open();
    ({ evaluate } = windowDriver(win));

    const models = await call("listModels", "live");
    const before = await readFile(authFile, "utf8");
    const providerOf = (spec) => spec.slice(0, spec.indexOf("/"));
    const firstOf = (provider) => models.find(({ spec }) => providerOf(spec) === provider)?.spec;
    // The rule this check covers needs two providers in one credential file, and any pair does it: OpenAI +
    // Anthropic are used when both are listed (the pair it started with), else the first two the catalog holds.
    // One provider cannot run this check: there is no cross-provider history to keep.
    const openai =
      process.env.DUANG_LIVE_OPENAI ??
      models.find(({ spec }) => spec === "openai/gpt-5.5")?.spec ??
      firstOf("openai");
    const claude = models.find(({ spec }) => spec.startsWith("anthropic/claude-sonnet"))?.spec;
    const listed = [...new Set(models.map(({ spec }) => providerOf(spec)))];
    // OpenAI takes the first slot when it is listed: it is the provider the issue behind this check named, and
    // its model is chosen with care above rather than taken as the first the provider lists.
    const ordered = listed.includes("openai") ? ["openai", ...listed.filter((provider) => provider !== "openai")] : listed;
    const [defaultModel, otherModel] =
      openai && claude
        ? [openai, claude]
        : ordered.slice(0, 2).map((provider) => (provider === "openai" ? openai : firstOf(provider)));
    // Which half is missing, and what the catalog holds: "needs OpenAI and Anthropic" alone sent one reader
    // looking for a login when the real complaint was a model name the catalog had dropped.
    assert.ok(
      defaultModel && otherModel,
      `needs two providers in ${authFile} (OpenAI + Anthropic, or any other pair): ` +
        `${defaultModel ? `first ${defaultModel}` : "no provider listed"}, ` +
        `${otherModel ? `second ${otherModel}` : "nothing else listed"}` +
        ` (listed: ${models.map(({ spec }) => spec).join(", ") || "none"}${process.env.DUANG_LIVE_OTHER ? `, DUANG_LIVE_OTHER=${process.env.DUANG_LIVE_OTHER}` : ""})`,
    );
    const other = process.env.DUANG_LIVE_OTHER ?? otherModel;
    console.log(`Credential file: ${authFile}\nUsing: ${defaultModel} + ${other}`);

    // 1. The agent's default runs with the credentials already on this machine. The first provider is the one
    // `openai/gpt-5.5` names where it exists, because a ChatGPT account may not run every listed model (#5).
    assert.deepEqual(await call("setModel", "live", defaultModel), { ok: true });
    const first = crypto.randomUUID();
    const defaultRun = await call("send", "live", first, ASK);
    if (defaultRun.ok) {
      console.log(`${defaultModel} reply: ${JSON.stringify((await reply(first)).text)}`);
    } else {
      // A quota or entitlement refusal still proves the token resolved; a credential fault must not pass as one.
      assert.doesNotMatch(defaultRun.error.message, /not configured|refresh|unauthor|invalid[_ ]api|401/i);
      console.log(`${defaultModel} credentials accepted, provider refused the run: ${defaultRun.error.message}`);
    }

    // 2. A conversation moved to the other provider.
    const second = crypto.randomUUID();
    assert.deepEqual(await call("setModel", "live", other, second), { ok: true });
    assert.deepEqual(await call("send", "live", second, ASK), { ok: true }, `${other} conversation send`);

    // 3. Issue #5's reported case: the agent's default is the first provider again, and the conversation keeps
    // the model the other provider recorded, and still runs.
    assert.deepEqual(await call("setModel", "live", defaultModel), { ok: true });
    assert.equal((await call("openAgent", "live")).model, defaultModel, `agent default is ${defaultModel}`);
    assert.deepEqual(await call("send", "live", second, "Reply with exactly: STILL OK"), { ok: true }, "history send");
    const history = await reply(second);
    assert.equal(history.model, other, `the historical conversation kept its own model (${other})`);
    assert.match(history.text, /STILL OK/i);
    console.log(`${other} history (${history.model}) reply: ${JSON.stringify(history.text)}`);

    // Refresh may legitimately rewrite tokens; it must stay a readable file with the same providers.
    const after = await readFile(authFile, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(after)).sort(), Object.keys(JSON.parse(before)).sort());
    console.log(`Credential file ${after === before ? "unchanged" : "rewritten by OAuth refresh"}, providers intact.`);
    console.log(`Live check passed: ${defaultModel} as the agent's default, ${other} kept by its conversation, one credential file.`);
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
