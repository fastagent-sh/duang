/** Real Electron + preload + FastAgent; only the model's HTTP response is faked. No credentials or network needed. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// The parent removes the fixture only after Chromium has stopped writing its disk caches.
if (!process.versions.electron) {
  for (const override of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "duang-smoke-"));
    try {
      const child = spawnSync(electron, [fileURLToPath(import.meta.url)], {
        stdio: "inherit",
        env: { ...process.env, DUANG_SMOKE_ROOT: root, DUANG_SMOKE_AUTH_OVERRIDE: String(override), HOME: root },
        timeout: 90000,
      });
      process.exitCode = child.status ?? 1;
      if (process.exitCode) break;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
} else {
  const { app, BrowserWindow } = electron;
  async function run() {
    const root = process.env.DUANG_SMOKE_ROOT;
    assert.ok(root, "Run with node tests/smoke.mjs so the fixture is isolated");
    const workspace = join(root, "project");
    const data = join(root, "user-data");
    mkdirSync(join(data, "Shared Dictionary", "cache"), { recursive: true });
    app.setPath("userData", data);
    const configured = join(root, "configured", "fastagent");
    await Promise.all([
      mkdir(workspace),
      mkdir(configured, { recursive: true }),
      mkdir(join(root, ".pi", "agent"), { recursive: true }),
      mkdir(join(root, ".fastagent", ".secrets"), { recursive: true }),
    ]);
    // Isolate all credential stores before FastAgent is imported. Never use the developer's subscription.
    process.env.HOME = root;
    for (const name of Object.keys(process.env)) {
      if (/API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i.test(name)) delete process.env[name];
    }
    const codex = { type: "oauth", access: "synthetic-codex", refresh: "synthetic-refresh", expires: Date.now() + 3600000 };
    const stored = {
      openai: { type: "api_key", key: "smoke-key" },
      anthropic: { type: "oauth", access: "sk-ant-oat01-synthetic", refresh: "synthetic-refresh", expires: Date.now() + 3600000 },
      "openai-codex": codex,
    };
    // The expectation is FastAgent's own global path, not a copy of it: a duang default that drifts
    // from `fastagent login` must fail here rather than agree with a literal this file made up.
    const { GLOBAL_AUTH_PATH: defaultAuth } = await import("@fastagent-sh/fastagent/pi");
    const selectedAuth = process.env.DUANG_SMOKE_AUTH_OVERRIDE === "true" ? join(root, "custom-auth.json") : defaultAuth;
    if (selectedAuth !== defaultAuth) process.env.FASTAGENT_AUTH_PATH = selectedAuth;
    // Stores duang must never read on its own. Holding only `openai-codex` makes a wrong pick visible:
    // the `anthropic/...` assertions below cannot pass from these files.
    await writeFile(join(root, ".fastagent", "auth.json"), JSON.stringify({ "openai-codex": codex }));
    await writeFile(join(root, ".pi", "agent", "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "wrong-store" } }));
    if (selectedAuth !== defaultAuth) await writeFile(defaultAuth, JSON.stringify({ "openai-codex": codex }));
    await writeFile(selectedAuth, JSON.stringify(stored));
    await writeFile(join(configured, "fastagent.config.ts"), 'export default { model: "openai/gpt-4o-mini" };\n');
    // A skill is what `commands()` lists, so the composer's `/` completion has something to find.
    await mkdir(join(configured, "skills", "demo"), { recursive: true });
    await writeFile(
      join(configured, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: A skill the completion list should offer.\n---\n\nSay demo.\n",
    );
    await writeFile(join(workspace, "hello.txt"), "Hello from the workspace\n");
    await writeFile(
      join(data, "agents.json"),
      JSON.stringify([
        { id: "smoke", name: "Smoke", dir: workspace },
        { id: "configured", name: "Configured", dir: configured },
        // A directory that was registered and then moved or deleted: one broken agent, nothing else.
        { id: "gone", name: "Gone", dir: join(root, "moved-away") },
      ]),
    );

    let requests = 0;
    let hold = false;
    let anthropicRequests = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url instanceof Request ? url.url : url);
      const headers = new Headers(options.headers ?? (url instanceof Request ? url.headers : undefined));
      if (target === "https://platform.claude.com/v1/oauth/token") {
        throw new Error("Synthetic OAuth refresh rejected");
      }
      if (target.startsWith("https://api.anthropic.com/v1/messages")) {
        assert.equal(headers.get("authorization"), `Bearer ${stored.anthropic.access}`);
        anthropicRequests++;
        const events = [
          { type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant", content: [], model: "claude-sonnet-4-5", stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Anthropic smoke answer" } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
          { type: "message_stop" },
        ];
        return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      assert.match(target, /^https:\/\/api\.openai\.com\/v1\/responses$/, "unexpected outbound request");
      assert.equal(headers.get("authorization"), "Bearer smoke-key");
      requests++;
      if (hold) {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      const tool = requests === 1;
      const item = tool
        ? {
            id: "fc_smoke",
            type: "function_call",
            call_id: "call_smoke",
            name: "read",
            arguments: JSON.stringify({ path: join(workspace, "hello.txt") }),
          }
        : {
            id: `msg_${requests}`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Smoke answer", annotations: [] }],
          };
      const events = [
        { type: "response.created", response: { id: `resp_${requests}` } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) },
        },
        ...(tool ? [] : [{ type: "response.output_text.delta", output_index: 0, delta: "Smoke answer" }]),
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: `resp_${requests}`,
            status: "completed",
            output: [item],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ];
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    };

    let win;
    const errors = [];
    const timeout = setTimeout(() => {
      console.error("Electron smoke timed out");
      app.exit(1);
    }, 60000);
    async function evaluate(expression) {
      try {
        return await win.webContents.executeJavaScript(expression, true);
      } catch (error) {
        console.error("Renderer expression:", expression, "Console:", errors);
        throw error;
      }
    }
    async function until(expression, description) {
      for (let i = 0; i < 200; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${description}\n${await evaluate("document.body.innerText")}`);
    }
    async function click(text) {
      await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.firstElementChild?.textContent === ${JSON.stringify(text)});
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)});
    button.focus();
    button.click();
  })()`);
    }
    async function chooseModel(model) {
      await until("document.querySelector('dialog input') !== null", "model filter");
      await evaluate(`(() => {
        const input = document.querySelector('dialog input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(model)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(`document.querySelector('dialog').innerText.includes(${JSON.stringify(model)})`, "filtered model");
      await click(model);
    }
    async function type(text) {
      await evaluate(`(() => {
    const input = document.querySelector('textarea');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
    }
    async function message(text) {
      await evaluate(`(() => {
    const input = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
      await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
    }

    try {
      const loaded = new Promise((resolve) => {
        app.once("browser-window-created", (_event, window) => {
          win = window;
          win.webContents.on("console-message", (event) => {
            if (event.level === "error") errors.push(event.message);
          });
          win.webContents.once("did-finish-load", resolve);
        });
      });
      await import("../out/main/index.js");
      await loaded;
      await until("document.body.innerText.includes('Create agent here')", "plain project setup");
      assert.ok(
        !(await evaluate("document.body.innerText")).includes("is not a fastagent agent"),
        "the scaffold offer must not be contradicted by the runtime's `run fastagent init` error",
      );
      await click("Create agent here");
      await until("document.querySelector('dialog[open]') !== null", "first model picker opens automatically");
      await chooseModel("openai/gpt-4o-mini");
      await until(
        "document.querySelector('textarea') && !document.querySelector('textarea').disabled",
        "first model unlocks composer",
      );
      assert.equal(await readFile(join(workspace, "fastagent", "fastagent.config.ts"), "utf8"), "export default {};\n");
      await message("Read hello.txt and answer.");
      await until(
        "document.body.innerText.includes('Smoke answer') && !document.body.innerText.includes('working…')",
        "stream settles",
      );
      await until("document.querySelector('details')?.innerText.includes('done')", "tool trace finishes");
      assert.equal(requests, 2, "a real read tool ran between two model requests");
      // The card now separates arguments from result, so read the whole card rather than its first block.
      const transcript = await evaluate("document.querySelector('details').textContent");
      assert.match(transcript, /Hello from the workspace/);
      await click("openai/gpt-4o-mini");
      await until("document.querySelector('dialog[open]') !== null", "model picker reopens");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("document.querySelector('dialog') === null", "Escape dismisses the picker");
      assert.equal(
        await evaluate("document.activeElement?.title"),
        "Model for this agent",
        "picker restores focus to its trigger",
      );
      const firstSession = await evaluate("window.duang.openAgent('smoke').then(r => r.sessions[0].session)");
      assert.ok(firstSession);

      // Reopen through the actual UI and verify runtime-owned history, not the optimistic echo.
      await evaluate("document.querySelector('button[title^=\"New conversation\"]').click()");
      await until("document.body.innerText.includes('What should we work on')", "new conversation");
      await click("Read hello.txt and answer.");
      await until("document.body.innerText.includes('Smoke answer')", "durable history reopens");
      assert.equal((await evaluate("document.body.innerText")).split("Smoke answer").length - 1, 1);

      hold = true;
      await message("Hold this turn so I can stop it.");
      await until("document.querySelector('button[aria-label=\"Stop the run\"]') !== null", "active stop control");
      // State and consequences in words, not only in colour.
      assert.match(
        await evaluate("document.querySelector('button[aria-label=\"Stop the run\"]').title"),
        /not undone/,
      );
      assert.match(await evaluate("document.querySelector('button[aria-label=\"Smoke\"]').title"), /\nWorking$/);
      assert.match(await evaluate("document.querySelector('aside').innerText"), /working/, "state is readable, not hovered");
      await evaluate("document.querySelector('button[title^=\"New conversation\"]').click()");
      await until("document.body.innerText.includes('What should we work on')", "background run keeps going");
      const refused = await evaluate("window.duang.setModel('smoke', 'openai/gpt-4.1')");
      assert.equal(refused.ok, false);
      assert.equal(
        refused.error.code,
        "agent_busy",
        "a different conversation cannot strand a running agent by changing its model",
      );
      const deletion = await evaluate(`window.duang.deleteSession('smoke', ${JSON.stringify(firstSession)})`);
      assert.equal(deletion.ok, false, "a refused delete must not unsubscribe the running conversation");
      await click("Read hello.txt and answer.");
      await until("document.querySelector('button[aria-label=\"Stop the run\"]') !== null", "return to active run");
      await evaluate("document.querySelector('button[aria-label=\"Stop the run\"]').click()");
      await until("document.body.innerText.includes('run stopped')", "stopping is a settled transcript outcome");
      await until("document.querySelector('button[aria-label=\"Send\"]') !== null", "composer leaves running state");

      // Persisted registry and history survive reloading the renderer.
      win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await until("document.body.innerText.includes('Smoke answer')", "history after reload");
      hold = false;
      await evaluate("document.querySelector('button[aria-label=\"Configured\"]').click()");
      await until(
        "document.body.innerText.includes('What should we work on in Configured') && !document.querySelector('textarea').disabled",
        "directory-configured model",
      );
      await message("Use the configured model with the selected credentials.");
      await until("document.body.innerText.includes('Smoke answer') && !document.body.innerText.includes('working…')", "configured model uses the same credential file");

      const models = await evaluate("window.duang.listModels()");
      assert.equal(models.authPath, selectedAuth);
      assert.ok(models.specs.includes("anthropic/claude-sonnet-4-5"));
      const codexModel = models.specs.find((spec) => spec.startsWith("openai-codex/"));
      assert.ok(codexModel);
      const historical = await evaluate("window.duang.openAgent('configured').then(r => r.sessions[0].session)");
      await click("openai/gpt-4o-mini");
      await until("document.querySelector('dialog[open]') !== null", "cross-provider model picker");
      await chooseModel("anthropic/claude-sonnet-4-5");
      await until("!document.querySelector('textarea').disabled && document.body.innerText.includes('anthropic/claude-sonnet-4-5')", "selected conversation changes provider");
      await message("Use the Anthropic conversation model.");
      await until("document.body.innerText.includes('Anthropic smoke answer') && !document.body.innerText.includes('working…')", "synthetic Anthropic OAuth request");
      assert.equal(anthropicRequests, 1);

      // Change only the agent default, then reopen Anthropic history through a fresh renderer.
      // The read issued alongside the change must wait for the new runtime instead of reporting a
      // broken agent. Whether it lands inside the window is main's to schedule, so assert only the
      // outcome; the forced-window verification is described in the PR.
      const racing = await evaluate(`(async () => {
        const change = window.duang.setModel('configured', ${JSON.stringify(codexModel)});
        const reads = [];
        for (let i = 0; i < 40; i++) {
          reads.push(window.duang.openAgent('configured'));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return [await change, await Promise.all(reads)];
      })()`);
      assert.equal(racing[0].ok, true);
      assert.ok(
        racing[1].every((read) => read.ok),
        "a read during a settings change waits for the new runtime, it does not report a broken agent",
      );
      win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await until("document.body.innerText.includes('Smoke answer')", "reload initial agent");
      await evaluate("document.querySelector('button[aria-label=\"Configured\"]').click()");
      await until("document.body.innerText.includes('anthropic/claude-sonnet-4-5') && !document.querySelector('textarea').disabled", "history keeps its provider despite Codex default");
      assert.equal(await evaluate("window.duang.openAgent('configured').then(r => r.model)"), codexModel);
      await message("Continue the historical Anthropic conversation.");
      await until("document.body.innerText.split('Anthropic smoke answer').length === 3 && !document.body.innerText.includes('working…')", "mixed-provider history resolves its own credential");
      assert.equal(anthropicRequests, 2);

      // A missing historical provider fails without silently switching models; fixing the file needs no restart.
      await writeFile(selectedAuth, JSON.stringify({ "openai-codex": codex }));
      const missing = await evaluate(`window.duang.send('configured', ${JSON.stringify(historical)}, 'Missing provider check')`);
      assert.equal(missing.ok, false);
      assert.equal(missing.error.message, "Provider is not configured: anthropic");
      assert.equal(anthropicRequests, 2);
      assert.ok(!(await evaluate("window.duang.listModels()")).specs.some((spec) => spec.startsWith("anthropic/")));
      const expired = { ...stored, anthropic: { ...stored.anthropic, expires: 0 } };
      await writeFile(selectedAuth, JSON.stringify(expired));
      assert.ok((await evaluate("window.duang.listModels()")).specs.includes("anthropic/claude-sonnet-4-5"), "picker does not attempt OAuth refresh");
      const refreshFailure = await evaluate(`window.duang.send('configured', ${JSON.stringify(historical)}, 'Expired token check')`);
      assert.equal(refreshFailure.ok, false);
      assert.match(refreshFailure.error.message, /Synthetic OAuth refresh rejected/);
      assert.deepEqual(JSON.parse(await readFile(selectedAuth, "utf8")), expired, "failed refresh preserves the credential");
      await writeFile(selectedAuth, "{invalid");
      assert.match(await evaluate("window.duang.listModels().then(() => '', error => error.message)"), /corrupt auth file/);
      await writeFile(selectedAuth, JSON.stringify(stored));
      assert.ok((await evaluate("window.duang.listModels()")).specs.includes("anthropic/claude-sonnet-4-5"));
      const recovered = await evaluate(`window.duang.send('configured', ${JSON.stringify(historical)}, 'Retry with restored credentials')`);
      assert.equal(recovered.ok, true);
      assert.equal(anthropicRequests, 3);
      assert.deepEqual(JSON.parse(await readFile(selectedAuth, "utf8")), stored, "valid tokens are not refreshed or copied");
      // `/` completion: the names come from the agent's definition, Escape dismisses the list, and
      // accepting one leaves the line in the composer instead of sending it.
      await evaluate("document.querySelector('textarea').focus()");
      await type("/");
      await until("document.body.innerText.includes('A skill the completion list should offer')", "command list");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(
        "!document.body.innerText.includes('A skill the completion list should offer')",
        "Escape dismisses the command list",
      );
      await type("/d");
      await until("document.body.innerText.includes('A skill the completion list should offer')", "list reopens");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await until("document.querySelector('textarea').value === '/demo '", "Enter accepts the name, it does not send");
      await type("");

      // An agent with no skills must say so; silence here reads as a broken composer.
      await evaluate("document.querySelector('button[aria-label=\"Smoke\"]').click()");
      await until("document.body.innerText.includes('Smoke answer')", "back to the scaffolded agent");
      // Opening an agent and looking at its conversations are separate controls: the caret folds
      // the list without closing the conversation being read.
      await evaluate("document.querySelector('button[aria-label=\"Hide conversations of Smoke\"]').click()");
      await until(
        "document.querySelector('button[aria-label=\"Show conversations of Smoke\"]') !== null",
        "the agent folds",
      );
      assert.ok(
        !(await evaluate("document.querySelector('aside').innerText")).includes("Read hello.txt and answer."),
        "a folded agent hides its conversations",
      );
      assert.match(await evaluate("document.body.innerText"), /Smoke answer/, "folding does not close the transcript");
      await evaluate("document.querySelector('button[aria-label=\"Show conversations of Smoke\"]').click()");
      await until(
        "document.querySelector('aside').innerText.includes('Read hello.txt and answer.')",
        "the agent unfolds again",
      );
      // Expanding is per agent, so more than one roster can be open while a third is being read.
      await evaluate("document.querySelector('button[aria-label=\"Show conversations of Configured\"]')?.click()");
      await until(
        "document.querySelector('aside').innerText.includes('Use the configured model')",
        "a second agent lists its conversations without being opened",
      );
      assert.deepEqual(
        await evaluate(`(() => {
          const aside = document.querySelector('aside').innerText;
          return {
            smoke: aside.includes('Read hello.txt and answer.'),
            configured: aside.includes('Use the configured model with the selected credentials.'),
            reading: document.body.innerText.includes('Smoke answer'),
          };
        })()`),
        { smoke: true, configured: true, reading: true },
        "two agents list their conversations at once, and neither changes the transcript",
      );
      await type("/");
      await until("document.body.innerText.includes('No commands')", "an empty command list explains itself");
      await type("");

      // A registered directory that no longer exists breaks only its own agent, and stays removable.
      await evaluate("document.querySelector('button[aria-label=\"Gone\"]').click()");
      await until("document.body.innerText.includes('moved-away')", "the missing directory is named");
      // Removal is offered by the panel that explains the problem, not by the sidebar row, so look
      // for the button rather than for the word anywhere on screen.
      assert.ok(
        await evaluate(
          "[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Remove')",
        ),
        "a directory that no longer exists stays removable from the panel that explains it",
      );
      await evaluate("document.querySelector('button[aria-label=\"Smoke\"]').click()");
      await until("document.body.innerText.includes('Smoke answer')", "the other agents are unaffected");

      // The picker's own states: named for assistive technology, and honest when nothing matches.
      await click("openai/gpt-4o-mini");
      await until("document.querySelector('dialog[open]') !== null", "picker for its empty state");
      assert.equal(await evaluate("document.querySelector('dialog').getAttribute('aria-label')"), "Choose a model");
      // Opening the list is asking to type in it: showModal() would otherwise leave focus on Close.
      assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Filter models");
      await evaluate(`(() => {
        const input = document.querySelector('dialog input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no-such-model');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until("document.querySelector('dialog').innerText.includes('Nothing matches')", "no filter matches");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("document.querySelector('dialog') === null", "picker closes again");

      // Delete is reachable by keyboard, and it hides again when the focus that revealed it leaves:
      // the row keeps focus after a click, which used to keep the control on screen.
      assert.deepEqual(
        await evaluate(`(() => {
          const del = [...document.querySelectorAll('aside button[title="Delete conversation"]')][0];
          del.focus();
          const focused = getComputedStyle(del).opacity;
          del.closest('.group').querySelector('button').focus();
          return { focused, afterRowFocus: getComputedStyle(del).opacity };
        })()`),
        { focused: "1", afterRowFocus: "0" },
        "delete follows its own focus, not the row's",
      );

      // Whitespace is not a message, and the composer stops growing at eight lines.
      await type("   \n  ");
      // Disabled and still reachable, carrying the reason: a keyboard user gets it too.
      assert.deepEqual(
        await evaluate(`(() => {
          const send = document.querySelector('button[aria-label="Send"]');
          return { blocked: send.getAttribute('aria-disabled'), why: send.title, reachable: send.disabled === false };
        })()`),
        { blocked: "true", why: "Type a message first", reachable: true },
      );
      await type(Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"));
      assert.ok(
        await evaluate(`(() => {
          const input = document.querySelector('textarea');
          const lines = parseFloat(getComputedStyle(input).lineHeight);
          return input.clientHeight <= lines * 8 + 2 && input.scrollHeight > input.clientHeight;
        })()`),
        "the composer scrolls instead of growing past eight lines",
      );
      await type("");

      // An unreadable registry must read as a failure, not as a fresh install with no agents.
      const registry = join(data, "agents.json");
      const savedRegistry = await readFile(registry, "utf8");
      await writeFile(registry, "[{\"id\"");
      win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await until("document.body.innerText.includes('agents.json')", "registry failure is reported");
      const registryFailure = await evaluate("document.body.innerText");
      assert.ok(!registryFailure.includes("Add an agent directory"), "a corrupt registry is not an empty one");
      assert.ok(registryFailure.includes("Reveal agents.json"), "the person is shown where to fix it");
      await writeFile(registry, savedRegistry);
      await click("Retry");
      await until("document.body.innerText.includes('Smoke answer')", "Retry recovers the registry");
      assert.equal(await readFile(registry, "utf8"), savedRegistry, "a failed read never rewrites the registry");

      assert.equal(BrowserWindow.getAllWindows().length, 1);
      assert.deepEqual(errors, []);
      console.log(
        `Electron smoke passed (${selectedAuth === defaultAuth ? "default auth" : "explicit auth"}): local workflow, cross-provider history, missing/corrupt credentials and recovery`,
      );
    } catch (error) {
      console.error(error);
      if (win && !win.isDestroyed()) {
        const image = await win.webContents.capturePage();
        const path = fileURLToPath(new URL("../out/smoke-failure.png", import.meta.url));
        await writeFile(path, image.toPNG());
        console.error(`Screenshot: ${path}`);
      }
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(process.exitCode ?? 0);
    }
  }
  void run().catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
