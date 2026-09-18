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
  const root = mkdtempSync(join(tmpdir(), "duang-smoke-"));
  try {
    const child = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, DUANG_SMOKE_ROOT: root, HOME: root },
      timeout: 90000,
    });
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
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
    ]);
    // Isolate both credential stores before FastAgent is imported. Never use the developer's subscription.
    process.env.HOME = root;
    for (const name of Object.keys(process.env)) {
      if (/API_KEY|TOKEN|SECRET|^FASTAGENT_|PROXY$/i.test(name)) delete process.env[name];
    }
    await writeFile(
      join(root, ".pi", "agent", "auth.json"),
      JSON.stringify({ openai: { type: "api_key", key: "smoke-key" } }),
    );
    await writeFile(join(configured, "fastagent.config.ts"), 'export default { model: "openai/gpt-4o-mini" };\n');
    await writeFile(join(workspace, "hello.txt"), "Hello from the workspace\n");
    await writeFile(
      join(data, "agents.json"),
      JSON.stringify([
        { id: "smoke", name: "Smoke", dir: workspace },
        { id: "configured", name: "Configured", dir: configured },
      ]),
    );

    let requests = 0;
    let hold = false;
    globalThis.fetch = async (url, options = {}) => {
      assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/responses$/, "unexpected outbound request");
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
    async function message(text) {
      await evaluate(`(() => {
    const input = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
      await evaluate("document.querySelector('button[title^=\"Send\"]').click()");
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
      await click("Create agent here");
      await until("document.querySelector('dialog[open]') !== null", "first model picker opens automatically");
      await until("document.body.innerText.includes('openai/gpt-4o-mini')", "available models");
      await click("openai/gpt-4o-mini");
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
      const transcript = await evaluate("document.querySelector('details pre').textContent");
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
      await until("document.querySelector('button[title=\"Stop (Esc)\"]') !== null", "active stop control");
      await evaluate("document.querySelector('button[title^=\"New conversation\"]').click()");
      await until("document.body.innerText.includes('What should we work on')", "background run keeps going");
      const refused = await evaluate("window.duang.setModel('smoke', 'openai/gpt-4.1').then(() => '', e => e.message)");
      assert.match(
        refused,
        /conversation is running/,
        "a different conversation cannot strand a running agent by changing its model",
      );
      const deletion = await evaluate(`window.duang.deleteSession('smoke', ${JSON.stringify(firstSession)})`);
      assert.equal(deletion.ok, false, "a refused delete must not unsubscribe the running conversation");
      await click("Read hello.txt and answer.");
      await until("document.querySelector('button[title=\"Stop (Esc)\"]') !== null", "return to active run");
      await evaluate("document.querySelector('button[title=\"Stop (Esc)\"]').click()");
      await until("document.body.innerText.includes('run aborted')", "abort is a settled transcript outcome");
      await until("document.querySelector('button[title^=\"Send\"]') !== null", "composer leaves running state");

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
      await message("Use the configured model with pi credentials.");
      await until("document.body.innerText.includes('Smoke answer')", "configured model uses pi-only credentials too");
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      assert.deepEqual(errors, []);
      console.log(
        "Electron smoke passed: scaffold → model → send → tool → history → background run → model guard → abort → reload",
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
