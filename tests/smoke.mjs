/** Real Electron + preload + FastAgent; only the model's HTTP response is faked. No credentials or network needed. */
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  const { app, BrowserWindow, Menu } = electron;
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
    // A definition-local endpoint (#59): listed for this agent only, and accepted as its model.
    await writeFile(
      join(configured, "models.json"),
      JSON.stringify({
        providers: {
          local: { baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "ollama", models: [{ id: "m1" }] },
        },
      }),
    );
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
    /** When set, the model's answer waits for this: a run that finishes while you are elsewhere. */
    let gate;
    let anthropicRequests = 0;
    let usageRequests = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url instanceof Request ? url.url : url);
      const headers = new Headers(options.headers ?? (url instanceof Request ? url.headers : undefined));
      if (target === "https://platform.claude.com/v1/oauth/token") {
        throw new Error("Synthetic OAuth refresh rejected");
      }
      if (target === "https://api.anthropic.com" && options.method === "HEAD") return new Response(null, { status: 204 });
      if (target === "https://api.anthropic.com/api/oauth/usage") {
        // The plan windows the header shows, read with the same login the conversation runs on.
        assert.equal(headers.get("authorization"), `Bearer ${stored.anthropic.access}`);
        usageRequests++;
        return Response.json({
          five_hour: { utilization: 4, resets_at: new Date(Date.now() + 3 * 3600_000).toISOString() },
          seven_day: { utilization: 18, resets_at: new Date(Date.now() + 2 * 86_400_000).toISOString() },
        });
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
      if (gate) await gate;
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
    /** The open agent's conversations are in the header's list, which a test opens the way a person does. */
    const listOpen = "!!document.querySelector('#conversations:popover-open')";
    async function showConversations() {
      if (!(await evaluate(listOpen))) await evaluate(`document.querySelector('main > header button[title="Conversations"]').click()`);
      await until(listOpen, "the conversation list opens");
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
      // The keyboard and focus checks need the page to have focus: without it Chromium moves
      // `activeElement` but fires no focus event, and the roster's "last reached" row never updates.
      // Stealing OS focus is not reliable on macOS 14 and later while another app is in use, so the
      // page is told to behave as focused instead, as Playwright does for every Chromium page.
      win.webContents.debugger.attach();
      await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await until("document.body.innerText.includes('Create agent here')", "plain project setup");
      assert.ok(
        !(await evaluate("document.body.innerText")).includes("is not a fastagent agent"),
        "the scaffold offer must not be contradicted by the runtime's `run fastagent init` error",
      );
      await click("Create agent here");
      await until("document.querySelector('dialog[open]') !== null", "first model picker opens automatically");
      await chooseModel("openai/gpt-4o-mini");
      await until("document.querySelector('dialog') === null", "first model picker closes");
      await until(
        "document.querySelector('textarea') && !document.querySelector('textarea').disabled",
        "first model unlocks composer",
      );
      assert.equal(await readFile(join(workspace, "fastagent", "fastagent.config.ts"), "utf8"), "export default {};\n");
      await message("Read hello.txt and answer.");
      await until(
        "document.querySelector('main').innerText.includes('Smoke answer') && !document.querySelector('main').innerText.includes('working…')",
        "stream settles",
      );
      // A tool that worked says nothing (§9, third tier): the card is finished when its result is
      // in and the running badge is gone.
      await until(
        `(() => {
          const card = document.querySelector('details');
          return card && card.textContent.includes('Hello from the workspace') && !card.textContent.includes('running');
        })()`,
        "tool trace finishes",
      );
      assert.equal(requests, 2, "a real read tool ran between two model requests");
      // The header floats over the transcript, as Telegram's does: text scrolls beneath it, the
      // transcript's own top padding starts the first turn below it, and it lets the wheel through.
      assert.ok(
        await evaluate(`(() => {
          const header = document.querySelector('main > header').getBoundingClientRect();
          const transcript = document.querySelector('[aria-label="Transcript"]');
          const box = transcript.getBoundingClientRect();
          return (
            box.top < header.bottom &&
            box.top + parseFloat(getComputedStyle(transcript).paddingTop) >= header.bottom &&
            getComputedStyle(document.querySelector('main > header')).pointerEvents === 'none'
          );
        })()`),
        "the header floats over the transcript without covering its first turn or catching the wheel",
      );
      assert.ok(
        await evaluate(`(() => {
          const summary = document.querySelector('details summary').textContent;
          return summary.includes('project/hello.txt') && !summary.includes('duang-smoke-');
        })()`),
        "a tool row names the file, not a machine-specific path",
      );
      assert.ok(
        await evaluate("document.querySelector('textarea').getBoundingClientRect().height <= 32"),
        "the empty composer starts compact and can grow with a draft",
      );
      // A settled answer ends with when it landed and a way to take it elsewhere.
      assert.ok(
        await evaluate(`(() => {
          const copy = document.querySelector('main button[aria-label="Copy message"]');
          // A character class, not \\d: a template literal eats the escape and the regex stops matching.
          return !!copy && /[0-9]{1,2}:[0-9]{2}/.test(copy.parentElement.textContent);
        })()`),
        "an answer is followed by its time and a copy control",
      );

      // The card now separates arguments from result, so read the whole card rather than its first block.
      const transcript = await evaluate("document.querySelector('details').textContent");
      assert.match(transcript, /Hello from the workspace/);
      await click("openai/gpt-4o-mini");
      await until("document.querySelector('dialog button[aria-current=\"true\"]') !== null", "model picker reopens with the current model");
      assert.equal(
        await evaluate(`(() => {
          const selected = document.querySelector('dialog button[aria-current="true"]');
          return selected?.parentElement.firstElementChild === selected ? selected.textContent.trim() : undefined;
        })()`),
        "openai/gpt-4o-mini",
        "the current model appears first in the picker",
      );
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
      await showConversations();
      await evaluate(`document.querySelector('button[title^="New conversation"]').focus()`);
      await until(`document.activeElement?.title?.startsWith('New conversation')`, "new conversation row focused");
      await evaluate(`document.activeElement.click()`);
      await until("document.body.innerText.includes('What should we work on')", "new conversation");
      assert.equal(await evaluate(listOpen), false, "choosing from the list puts it away");
      await until(
        `document.activeElement?.getAttribute('aria-label') === 'Message' && !document.activeElement.disabled`,
        "new conversation gives focus to the ready composer",
      );
      await showConversations();
      await click("Read hello.txt and answer.");
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "durable history reopens");
      assert.equal((await evaluate("document.querySelector('main').innerText")).split("Smoke answer").length - 1, 1);

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
      // Escape on the open list closes the list; it is not also a Stop. Not even in the same task
      // that opened it, before React has heard the popover's asynchronous `toggle` event: a slow
      // machine delivers a real Escape inside that gap.
      await evaluate(`(() => {
        document.querySelector('main > header button[title="Conversations"]').click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(
        await evaluate("!!document.querySelector('button[aria-label=\"Stop the run\"]')"),
        "an Escape the instant the list opens does not stop the run",
      );
      await until(listOpen, "the list is open");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(`!${listOpen}`, "Escape closes the list over a running turn");
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(await evaluate("!!document.querySelector('button[aria-label=\"Stop the run\"]')"), "and the run keeps going");
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

      // A run that finishes while another conversation is on screen is the thing you came back for:
      // the sidebar keeps a filled mark and the dock carries the count until it is looked at.
      hold = false;
      let release;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      await message("Answer while I look elsewhere.");
      await evaluate("document.querySelector('button[title^=\"New conversation\"]').click()");
      await until("document.body.innerText.includes('What should we work on')", "left the running conversation");
      release();
      gate = undefined;
      const unseenMark = "document.querySelector('aside [title$=\"while you were away\"]')";
      await until(`${unseenMark}?.textContent.startsWith('1')`, "an outcome nobody saw is counted on its agent's row");
      assert.equal(electron.app.getBadgeCount(), 1, "and counted on the dock");
      assert.equal(
        await evaluate("document.querySelector('main > header button[title=\"Conversations\"]').getAttribute('aria-label')"),
        "Conversations, 1 unseen",
        "the list button says there is something in it to look at",
      );
      // The message went into the conversation that was already open, so find the row by the mark
      // it is carrying rather than by a label.
      await showConversations();
      await evaluate(`(() => {
        const row = [...document.querySelectorAll('#conversations button[data-session]')].find((b) => b.textContent.endsWith('done'));
        if (!row) throw new Error('Missing the marked conversation row');
        row.click();
      })()`);
      await until(`${unseenMark} === null`, "looking at it spends the mark");
      assert.equal(electron.app.getBadgeCount(), 0, "and clears the dock");

      // Persisted registry and history survive reloading the renderer.
      win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "history after reload");
      hold = false;
      await evaluate("document.querySelector('button[aria-label=\"Configured\"]').click()");
      await until(
        "document.body.innerText.includes('What should we work on?') && !document.querySelector('textarea').disabled",
        "directory-configured model",
      );
      await message("Use the configured model with the selected credentials.");
      await until("document.querySelector('main').innerText.includes('Smoke answer') && !document.querySelector('main').innerText.includes('working…')", "configured model uses the same credential file");

      const models = await evaluate("window.duang.listModels('configured')");
      assert.equal(models.authPath, selectedAuth);
      assert.ok(models.specs.includes("anthropic/claude-sonnet-4-5"));
      const codexModel = models.specs.find((spec) => spec.startsWith("openai-codex/"));
      assert.ok(codexModel);
      assert.ok(models.specs.includes("local/m1"), "the agent's own models.json endpoint is pickable");
      assert.ok(!(await evaluate("window.duang.listModels('smoke')")).specs.includes("local/m1"), "another agent's endpoint is not");
      const historical = await evaluate("window.duang.openAgent('configured').then(r => r.sessions[0].session)");
      await click("openai/gpt-4o-mini");
      await until("document.querySelector('dialog[open]') !== null", "cross-provider model picker");
      await chooseModel("anthropic/claude-sonnet-4-5");
      await until("!document.querySelector('textarea').disabled && document.body.innerText.includes('anthropic/claude-sonnet-4-5')", "selected conversation changes provider");
      await message("Use the Anthropic conversation model.");
      await until("document.querySelector('main').innerText.includes('Anthropic smoke answer') && !document.querySelector('main').innerText.includes('working…')", "synthetic Anthropic OAuth request");
      assert.equal(anthropicRequests, 1);
      await until("/5h[\\s\\S]*4%[\\s\\S]*7d[\\s\\S]*18%/.test(document.querySelector('header').innerText)", "the header shows the subscription's plan windows");
      assert.equal(usageRequests, 1, "the run ending inside the gap reuses the answer instead of asking again");

      // Change only the agent default, then reopen Anthropic history through a fresh renderer.
      // The read issued alongside the change must wait for the new runtime instead of reporting a
      // broken agent. Whether it lands inside the window is main's to schedule, so assert only the
      // outcome; the forced-window verification is described in the PR.
      assert.deepEqual(await evaluate("window.duang.setModel('configured', 'local/m1')"), { ok: true }, "setModel accepts it");
      assert.equal((await evaluate("window.duang.setModel('configured', 'local/nope')")).error.code, "model_unavailable");
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
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "reload initial agent");
      await evaluate("document.querySelector('button[aria-label=\"Configured\"]').click()");
      await until("document.body.innerText.includes('anthropic/claude-sonnet-4-5') && !document.querySelector('textarea').disabled", "history keeps its provider despite Codex default");
      assert.equal(await evaluate("window.duang.openAgent('configured').then(r => r.model)"), codexModel);
      await message("Continue the historical Anthropic conversation.");
      await until("document.querySelector('main').innerText.split('Anthropic smoke answer').length === 3 && !document.querySelector('main').innerText.includes('working…')", "mixed-provider history resolves its own credential");
      assert.equal(anthropicRequests, 2);

      // A missing historical provider fails without silently switching models; fixing the file needs no restart.
      await writeFile(selectedAuth, JSON.stringify({ "openai-codex": codex }));
      const missing = await evaluate(`window.duang.send('configured', ${JSON.stringify(historical)}, 'Missing provider check')`);
      assert.equal(missing.ok, false);
      assert.equal(missing.error.message, "Provider is not configured: anthropic");
      assert.equal(anthropicRequests, 2);
      assert.ok(!(await evaluate("window.duang.listModels('configured')")).specs.some((spec) => spec.startsWith("anthropic/")));
      const expired = { ...stored, anthropic: { ...stored.anthropic, expires: 0 } };
      await writeFile(selectedAuth, JSON.stringify(expired));
      assert.ok((await evaluate("window.duang.listModels('configured')")).specs.includes("anthropic/claude-sonnet-4-5"), "picker does not attempt OAuth refresh");
      const refreshFailure = await evaluate(`window.duang.send('configured', ${JSON.stringify(historical)}, 'Expired token check')`);
      assert.equal(refreshFailure.ok, false);
      assert.match(refreshFailure.error.message, /Synthetic OAuth refresh rejected/);
      assert.deepEqual(JSON.parse(await readFile(selectedAuth, "utf8")), expired, "failed refresh preserves the credential");
      await writeFile(selectedAuth, "{invalid");
      assert.match(await evaluate("window.duang.listModels('configured').then(() => '', error => error.message)"), /corrupt auth file/);
      await writeFile(selectedAuth, JSON.stringify(stored));
      assert.ok((await evaluate("window.duang.listModels('configured')")).specs.includes("anthropic/claude-sonnet-4-5"));
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
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "back to the scaffolded agent");
      // The roster lists agents, and each row quotes the newest output of the conversation it would
      // open: Configured's is read from its history while Smoke's transcript is being read.
      await until(
        "document.getElementById('status-configured')?.innerText.includes('Anthropic smoke answer')",
        "another agent's row quotes its conversation's newest output",
      );
      assert.match(await evaluate("document.querySelector('main').innerText"), /Smoke answer/, "without opening it");
      // Its conversations are in the header's list instead, and Escape puts the list away.
      await showConversations();
      assert.ok(
        (await evaluate("document.querySelector('#conversations').innerText")).includes("Read hello.txt and answer."),
        "the header's list holds the open agent's conversations",
      );
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(`!${listOpen}`, "Escape closes the list");
      await type("/");
      await until("document.body.innerText.includes('No commands')", "an empty command list explains itself");
      await type("");

      // A registered directory that no longer exists breaks only its own agent, and stays removable.
      await evaluate("document.querySelector('button[aria-label=\"Gone\"]').click()");
      await until("document.body.innerText.includes('moved-away')", "the missing directory is named");
      // Removal is offered by the panel that explains the problem, not by the sidebar row, so look
      // for the button rather than for the word anywhere on screen.
      await until(
        "[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Remove')",
        "a directory that no longer exists stays removable from the panel that explains it",
      );
      // An agent's name is duang's label, so even a broken agent can be renamed; the directory is not.
      await evaluate(`document.querySelector('button[aria-label="Gone"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await until("document.querySelector('aside input[aria-label=\"Agent name\"]') !== null", "agent rename opens");
      await evaluate(`(() => {
        const input = document.querySelector('aside input[aria-label="Agent name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Gone for good');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await until("document.querySelector('button[aria-label=\"Gone for good\"]') !== null", "the roster shows the new name");
      assert.equal(
        JSON.parse(await readFile(join(data, "agents.json"), "utf8")).find((row) => row.id === "gone").name,
        "Gone for good",
        "the name is kept in the registry",
      );
      await evaluate("document.querySelector('button[aria-label=\"Smoke\"]').click()");
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "the other agents are unaffected");

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

      // One tab stop for the roster, arrows inside it (§11).
      const roster = () =>
        evaluate(`(() => {
          const rows = [...document.querySelectorAll('aside [aria-label="Agents"] button')];
          return { rows: rows.length, tabbable: rows.filter((b) => b.tabIndex === 0).length };
        })()`);
      const counted = await roster();
      assert.ok(counted.rows > 1, "there is more than one row to walk");
      assert.equal(counted.tabbable, 1, "the roster is one tab stop, not one per row");
      assert.equal(
        await evaluate(`[...document.querySelectorAll('aside > :not([aria-label="Agents"]) button')].find((b) => b.textContent.trim() === 'Settings')?.tabIndex`),
        0,
        "Settings, outside the roster, is its own tab stop",
      );

      // A real Tab, from the control before the list: the point of a roving tabindex is that Tab
      // can enter the roster at all.
      await evaluate("document.querySelector('aside button[aria-label=\"Add agent directory\"]').focus()");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      win.webContents.sendInputEvent({ type: "char", keyCode: "Tab" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
      await until(
        "document.activeElement.closest('aside [aria-label=Agents]') !== null",
        "Tab enters the roster from outside it",
      );

      // Keys go one at a time: two in the same tick would be read against state React has not
      // re-rendered yet, which is not how anyone types.
      const press = (key) =>
        evaluate(
          `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`,
        );
      await evaluate("document.querySelector('aside [aria-label=Agents] button[tabindex=\"0\"]').focus()");
      // The rename handed the focus back to its row, and the keyboard stays where it was last moved.
      assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Gone for good");
      await press("ArrowUp");
      await until("document.activeElement.getAttribute('aria-label') === 'Configured'", "Up reaches the agent above");
      await press("Home");
      await until("document.activeElement.getAttribute('aria-label') === 'Smoke'", "Home reaches the first");

      // Naming a conversation. The menu that carries Rename is native, so the test drives what the
      // menu would: a double click on the row, which is the other way in.
      await showConversations();
      await evaluate(`(() => {
        const row = [...document.querySelectorAll('#conversations button[data-session]')].find((b) =>
          b.textContent.includes('Read hello.txt and answer.'),
        );
        if (!row) throw new Error('Missing the conversation row');
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()`);
      await until("document.querySelector('#conversations input[aria-label=\"Conversation name\"]') !== null", "rename opens");
      await evaluate(`(() => {
        const input = document.querySelector('#conversations input[aria-label="Conversation name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'The i18n check');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await until(
        "document.querySelector('#conversations').innerText.includes('The i18n check')",
        "the runtime reports the name it was given",
      );
      assert.ok(
        !(await evaluate("document.querySelector('#conversations').innerText")).includes("Read hello.txt and answer."),
        "a named conversation stops falling back to its first message",
      );

      // A way back to the live turn: absent at the bottom, offered once the tail is not followed,
      // and gone again after it takes you back.
      const backToLatest = "document.querySelector('button[aria-label=\"Back to the latest\"]')";
      assert.equal(await evaluate(`${backToLatest} === null`), true, "nothing to offer while at the bottom");
      // The smoke conversation is short, so make the window small enough for it to overflow — the
      // control only means anything when there is something to scroll past.
      const size = win.getSize();
      win.setSize(800, 540);
      await until(
        "document.querySelector('aside').getBoundingClientRect().width <= 260",
        "the sidebar gives reading space back in a narrow window",
      );
      await until(
        `(() => { const el = document.querySelector('[aria-label="Transcript"]'); return el.scrollHeight > el.clientHeight + 40; })()`,
        "the transcript can scroll",
      );
      // Each poll re-issues the scroll: the tail-following effect can pull the view back in the same
      // frame, and a test that scrolls once is testing that race instead of the control.
      const atTop = `(() => {
        const el = document.querySelector('[aria-label="Transcript"]');
        el.scrollTop = 0;
        return ${backToLatest} !== null;
      })()`;
      const atBottom = `(() => {
        const el = document.querySelector('[aria-label="Transcript"]');
        el.scrollTop = el.scrollHeight;
        return ${backToLatest} === null;
      })()`;
      // A resize can make a transcript scrollable with no scroll event to notice it, so settle at
      // the bottom first: the control has to be absent there before it means anything above.
      await until(atBottom, "still nothing to offer at the bottom of a small window");
      await until(atTop, "scrolling up offers the way back");
      await evaluate(`${backToLatest}.click()`);
      await until(`${backToLatest} === null`, "and it is gone once the transcript is back at the bottom");
      assert.ok(
        await evaluate(`(() => {
          const el = document.querySelector('[aria-label="Transcript"]');
          return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        })()`),
        "the transcript is at the bottom again",
      );
      win.setSize(size[0], size[1]);

      // The row's actions control follows its own focus: the row keeps focus after a click, which
      // used to keep the control on screen. Reaching the actions by keyboard is the context menu's
      // job (Shift+F10) and Delete's, not the tab order's. Opacity is read after the transition
      // settles, not during it.
      await showConversations();
      const actionsOpacity = `(() => {
        const actions = [...document.querySelectorAll('#conversations button[title="Conversation actions"]')][0];
        return getComputedStyle(actions).opacity;
      })()`;
      await evaluate("[...document.querySelectorAll('#conversations button[title=\"Conversation actions\"]')][0].focus()");
      await until(`${actionsOpacity} === '1'`, "a focused actions control is visible");
      await evaluate(
        "[...document.querySelectorAll('#conversations button[title=\"Conversation actions\"]')][0].closest('.group').querySelector('button').focus()",
      );
      await until(`${actionsOpacity} === '0'`, "and hides again when the row takes the focus back");

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
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, cancelable: true }))`);
      await until("document.body.innerText.includes('What should we work on?')", "⌘N starts a conversation");
      await until(
        `document.activeElement?.getAttribute('aria-label') === 'Message' && !document.activeElement.disabled`,
        "⌘N focuses the new conversation's composer",
      );

      // Settings open beside the sidebar; Off and Manual are saved and applied at once; a test names
      // the route; an invalid URL is refused with its reason; an unreadable file is reported, not
      // shown as the defaults; Escape leaves.
      const settingsFile = join(data, "settings.json");
      const fill = (label, value) =>
        evaluate(`(() => {
          const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
      const choose = (label) =>
        evaluate(`[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
      // The App menu owns Settings… (⌘,); clicking the item is what the shortcut does.
      const settingsItem = Menu.getApplicationMenu().getMenuItemById("settings");
      assert.equal(settingsItem.accelerator, "Command+,");
      assert.ok(Menu.getApplicationMenu().items.some((item) => item.role === "editmenu"), "copy and paste keep their menu");
      settingsItem.click();
      // The chosen row checks its own connection on arrival; there is no button to find first.
      await until("document.querySelector('#network-heading') && /connected · \\d+ ms/.test(document.body.innerText)", "Settings… opens Settings and checks the route");
      assert.ok(await evaluate(`!!document.querySelector('button[aria-label="Configured"]')`), "the sidebar stays in view");
      assert.deepEqual(
        await evaluate(`[...document.querySelectorAll('aside [aria-current]')].map((el) => el.textContent.trim())`),
        ["Settings"],
        "while Settings shows, its row is the one selection mark",
      );
      settingsItem.click();
      assert.ok(await evaluate("!!document.querySelector('#network-heading')"), "asking again keeps Settings open");
      await choose("Off");
      await until("document.querySelector('[data-source=off] .font-mono')?.textContent === 'Direct' && /connected · \\d+ ms/.test(document.querySelector('[data-source=off]').textContent)", "Off applies at once and is checked");
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "off" });
      assert.equal(await evaluate(`document.querySelector('[role=radio][aria-checked=true]').textContent.trim().split('Direct')[0]`), "Off");
      // Manual with nothing saved shows its form and applies nothing until the proxy is complete.
      await choose("Manual");
      await until("document.querySelector('input[aria-label=Server]')", "the manual form");
      await click("Use this proxy");
      await until("document.body.innerText.includes('Server is required')", "an empty server is refused");
      await fill("Server", "127.0.0.1");
      await fill("Port", "70000");
      await click("Use this proxy");
      await until("document.body.innerText.includes('Port is a number from 1 to 65535')", "an impossible port is refused");
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "off" }, "a refused proxy is not saved");
      await choose("SOCKS5");
      await choose("HTTP");
      await fill("Port", "9");
      await click("Use this proxy");
      await until("document.querySelector('[data-source=manual] .font-mono')?.textContent === 'http://127.0.0.1:9'", "Manual applies");
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "manual", url: "http://127.0.0.1:9" });
      // A scheme's default port is saved and read back, not dropped to an empty field.
      await fill("Port", "80");
      await click("Use this proxy");
      await until("document.querySelector('[data-source=manual] .font-mono')?.textContent === 'http://127.0.0.1:80'", "port 80 applies");
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "manual", url: "http://127.0.0.1:80" });
      await evaluate(`document.querySelector('button[aria-label="Close settings"]').click()`);
      settingsItem.click();
      await until("document.querySelector('input[aria-label=Port]')?.value === '80'", "the reopened form shows port 80");
      await choose("Automatic");
      await until("!!document.querySelector('[data-source=system]')", "Automatic follows the system");
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "automatic" });
      // Two choices in one tick are applied in order: the file, Chromium and the page end on the second.
      await evaluate(`(() => {
        const rows = [...document.querySelectorAll('[role=radio]')];
        rows.find((r) => r.textContent.trim().startsWith('Off')).click();
        rows.find((r) => r.textContent.trim().startsWith('Automatic')).click();
      })()`);
      // The clicks return before either change lands, so wait for the file to stop changing.
      for (let last = -1, now = (await stat(settingsFile)).mtimeMs; now !== last; ) {
        last = now;
        await new Promise((resolve) => setTimeout(resolve, 500));
        now = (await stat(settingsFile)).mtimeMs;
      }
      assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")).network, { mode: "automatic" });
      assert.equal((await evaluate("window.duang.getSettings()")).route.source, "system", "Chromium ended on the second choice too");
      await until("document.querySelector('[data-source=system]')?.textContent.includes('connected')", "the page ends on the second choice");
      // Enter on the refresh control checks again; it does not re-apply (rewrite) the choice.
      const written = (await stat(settingsFile)).mtimeMs;
      await evaluate(`document.querySelector('button[aria-label="Check the connection again"]').focus()`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await until("/connected · \\d+ ms/.test(document.body.innerText)", "the check runs again");
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal((await stat(settingsFile)).mtimeMs, written, "Enter on refresh did not re-apply the setting");
      // One tab stop per choice group, on the checked row; the arrows move the choice and wrap.
      assert.deepEqual(
        await evaluate(`[...document.querySelectorAll('[role=radiogroup]')].map((g) => g.querySelectorAll('[role=radio][tabindex="0"]').length)`),
        [1],
        "the Proxy group is one tab stop",
      );
      const key = (keyCode) => {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode });
      };
      await evaluate(`document.querySelector('[role=radio][aria-checked=true]').focus()`);
      key("Up");
      await until("!!document.querySelector('[data-source=off]')", "ArrowUp from the first row wraps to Off and chooses it");
      key("Down");
      await until("!!document.querySelector('[data-source=system]') && document.activeElement?.textContent.trim().startsWith('Automatic')", "ArrowDown wraps back to Automatic");
      await writeFile(settingsFile, "{broken");
      await evaluate(`document.querySelector('button[aria-label="Close settings"]').click()`);
      await until("!document.querySelector('#network-heading')", "the close control leaves Settings");
      // The sidebar's own way in, at its foot.
      await click("Settings");
      await until("document.body.innerText.includes('settings.json') && document.body.innerText.includes('Reveal in Finder')", "an unreadable settings file is reported");
      assert.ok(!(await evaluate("!!document.querySelector('#network-heading')")), "a broken file is not shown as the defaults");
      await writeFile(settingsFile, JSON.stringify({ network: { mode: "automatic" } }));
      await click("Retry");
      await until("document.querySelector('#network-heading')", "Retry reads the fixed file");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("!document.querySelector('#network-heading') && document.querySelector('textarea')", "Escape leaves Settings");

      // A route duang cannot take (SOCKS4, from a PAC file) is shown, not fatal: a send still goes
      // out, agent commands just get no proxy, and the page says both. Choosing again recovers.
      await electron.session.defaultSession.setProxy({
        mode: "pac_script",
        pacScript: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent('function FindProxyForURL() { return "SOCKS 127.0.0.1:1080"; }')}`,
      });
      assert.equal(await electron.session.defaultSession.resolveProxy("https://github.com"), "SOCKS 127.0.0.1:1080");
      const answers = () => evaluate("document.querySelector('main').innerText.split('Smoke answer').length");
      const before = await answers();
      await message("Send through a SOCKS4 PAC answer.");
      await until(`document.querySelector('main').innerText.split('Smoke answer').length > ${before} && !document.querySelector('main').innerText.includes('working…')`, "a send is not stopped by the commands' route");
      settingsItem.click();
      await until(
        "document.body.innerText.includes('unsupported proxy route') && document.body.innerText.includes('Agent commands get no proxy: Unsupported proxy route \"SOCKS 127.0.0.1:1080\"')",
        "both unusable routes are shown, and the settings file is not blamed",
      );
      assert.ok(!(await evaluate("document.body.innerText.includes('Fix or remove the file')")));
      await choose("Automatic");
      await until("!!document.querySelector('[data-source=system]') && !document.body.innerText.includes('Agent commands get no proxy')", "choosing again recovers");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("!document.querySelector('#network-heading')", "Escape leaves Settings again");

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
      await until("document.querySelector('main').innerText.includes('Smoke answer')", "Retry recovers the registry");
      assert.equal(await readFile(registry, "utf8"), savedRegistry, "a failed read never rewrites the registry");

      // The agent takes the whole header when its conversation has the same name; otherwise it
      // leaves room for the topic. Both cases retain the full agent name as a tooltip.
      const longName = "An agent with a deliberately long descriptive name for this workspace";
      await evaluate(`document.querySelector('button[aria-label="Smoke"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await until("document.querySelector('aside input[aria-label=\"Agent name\"]')", "agent rename opens");
      await evaluate(`(() => {
        const input = document.querySelector('aside input[aria-label="Agent name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(longName)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      const headerName = `(() => {
        const line = document.querySelector('main > header .drag.flex');
        const name = line.firstElementChild;
        return { width: name.getBoundingClientRect().width, available: line.clientWidth, title: name.title };
      })()`;
      await until(`document.querySelector('main > header .drag.flex span')?.textContent === ${JSON.stringify(longName)}`, "renamed agent in header");
      const withTopic = await evaluate(headerName);
      assert.ok(withTopic.width <= withTopic.available * 0.35 + 1, "the topic keeps its space");
      assert.equal(withTopic.title, longName);
      await showConversations();
      await evaluate(`document.querySelector('#conversations button[aria-current="page"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await until("document.querySelector('#conversations input[aria-label=\"Conversation name\"]')", "conversation rename opens");
      await evaluate(`(() => {
        const input = document.querySelector('#conversations input[aria-label="Conversation name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(longName)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await until(`document.querySelector('main > header .drag.flex')?.childElementCount === 1`, "matching names share the header");
      const alone = await evaluate(headerName);
      assert.ok(alone.width > alone.available * 0.35 + 1, "the agent name uses the free width");
      assert.ok(alone.width <= alone.available + 1, "the agent name stays inside the header");
      assert.equal(alone.title, longName);

      assert.equal(BrowserWindow.getAllWindows().length, 1);
      assert.deepEqual(errors, []);

      // ⌘, with every window closed opens one already on Settings: the request waits in main for
      // the new renderer's listener instead of being sent before it exists.
      const closed = new Promise((resolve) => win.once("closed", resolve));
      win.close();
      await closed;
      Menu.getApplicationMenu().getMenuItemById("settings").click();
      const reopened = BrowserWindow.getAllWindows()[0];
      assert.ok(reopened, "Settings… opens a window when none is open");
      let onSettings = false;
      for (let i = 0; i < 200 && !onSettings; i++) {
        onSettings = await reopened.webContents
          .executeJavaScript("!!document.querySelector('#network-heading')", true)
          .catch(() => false);
        if (!onSettings) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(onSettings, "the new window lands on Settings");
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
