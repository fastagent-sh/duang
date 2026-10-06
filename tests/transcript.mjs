/**
 * The live end of a run, in the real window: Electron + preload + FastAgent + pi, with only the model faked by a
 * local OpenAI-compatible endpoint in the agent's own models.json. Each step holds the run where it is checked
 * (a tool waits for a file, the model's stream waits for a promise) rather than sleeping and hoping. No
 * credentials or network needed.
 *
 * What it guards: while a run is live the transcript ends in one line saying what the run is doing, and the
 * composer's round button stops or steers it (docs/ui.md §8, `liveEnd`).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

if (!process.versions.electron) {
  const root = mkdtempSync(join(tmpdir(), "duang-transcript-"));
  try {
    const child = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, DUANG_TRANSCRIPT_ROOT: root, HOME: root },
      timeout: 120000,
    });
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const { app } = electron;
  const root = process.env.DUANG_TRANSCRIPT_ROOT;
  assert.ok(root, "Run with node tests/transcript.mjs so the fixture is isolated");
  for (const name of Object.keys(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^FASTAGENT_|^PI_|PROXY$/i.test(name)) delete process.env[name];
  }
  const data = join(root, "user-data");
  const dir = join(root, "project");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(dir, "fastagent"), { recursive: true });
  app.setPath("userData", data);

  /** The model's next answers, in order. An answer may stop partway until `hold` resolves. */
  const script = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", async () => {
      const step = script.shift();
      assert.ok(step, "the model was asked more often than the scenario expects");
      if (step.status) {
        res.writeHead(step.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Overloaded", type: "server_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      if (step.thinking) res.write(chunk({ role: "assistant", reasoning_content: step.thinking }));
      if (step.text) res.write(chunk({ role: "assistant", content: step.text }));
      if (step.hold) await step.hold;
      if (step.rest) res.write(chunk({ content: step.rest }));
      if (step.tools)
        res.write(
          chunk({
            role: "assistant",
            tool_calls: step.tools.map((command, index) => ({ index, id: `call_${index}`, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } })),
          }),
        );
      res.write(chunk({}, step.tools ? "tool_calls" : "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(
    join(dir, "fastagent", "models.json"),
    JSON.stringify({ providers: { mock: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", apiKey: "mock", models: [{ id: "mock", reasoning: true }] } } }),
  );
  writeFileSync(join(dir, "fastagent", "fastagent.config.ts"), 'export default { model: "mock/mock" };\n');
  // A second agent whose one conversation is already long: made by FastAgent itself, before duang starts.
  const long = join(root, "long");
  mkdirSync(join(long, "fastagent"), { recursive: true });
  writeFileSync(join(long, "fastagent", "models.json"), readFileSync(join(dir, "fastagent", "models.json")));
  writeFileSync(join(long, "fastagent", "fastagent.config.ts"), 'export default { model: "mock/mock" };\n');
  const LONG_TURNS = 40;
  {
    const { createPiAgentFromDir } = await import("@fastagent-sh/fastagent/pi");
    const { agent } = await createPiAgentFromDir(long, { sessionControl: true, authPath: join(data, "long-auth.json") });
    for (let n = 1; n <= LONG_TURNS; n++) {
      script.push({ text: `Answer ${n}.` });
      for await (const event of agent.invoke({ session: "long" }, { text: `Turn ${n} of the long one` }))
        if (event.type === "failed") throw new Error(event.details);
    }
  }
  writeFileSync(
    join(data, "agents.json"),
    JSON.stringify([
      { id: "t", name: "Live", dir, colour: 3 },
      { id: "l", name: "Long", dir: long, colour: 5 },
    ]),
  );

  /**
   * A command that runs until the scenario lets it finish; it runs in the project, where the gate is made. It
   * gives up by itself after a minute, so a run killed before its gate is made (a timeout, or the parent ending
   * Electron) leaves no shell looping on a fixture that is gone.
   */
  const waitsFor = (name) => `for i in $(seq 600); do [ -e gate-${name} ] && exit 0; sleep 0.1; done; exit 1`;
  const release = (name) => writeFileSync(join(dir, `gate-${name}`), "");
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };

  let win;
  app.once("browser-window-created", (_event, window) => (win = window));
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  async function until(expression, what, ms = 20000) {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50)))
      if (await evaluate(expression).catch(() => false)) return;
    throw new Error(`Timed out: ${what}\n${await evaluate("document.querySelector('main')?.innerText").catch(() => "")}`);
  }
  /** Every live line in the transcript: the bouncing dot and the text of the row it is in. */
  const live = () =>
    evaluate(`[...document.querySelectorAll('[aria-label="Transcript"] .bounce')].map((dot) => ({
      text: dot.parentElement.innerText.replace(/\\s+/g, " ").trim(),
      inBlock: !!dot.closest("summary"),
    }))`);
  const transcript = () => evaluate(`document.querySelector('[aria-label="Transcript"]')?.innerText ?? ""`);
  const button = () => evaluate(`document.querySelector('button[aria-label="Stop the run"], button[aria-label="Steer the run"], button[aria-label="Send"], button[aria-label="Voice input"]')?.getAttribute('aria-label')`);
  const type = (text) =>
    evaluate(`(() => { const i = document.querySelector('textarea'); i.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  async function send(text) {
    await until("!!document.querySelector('textarea') && !document.querySelector('textarea').disabled", "the composer is ready");
    await type(text);
    await until("!!document.querySelector('button[aria-label=Send]')", "Send is offered");
    await evaluate("document.querySelector('button[aria-label=Send]').click()");
  }
  const idle = () => until(`!document.querySelector('button[aria-label="Stop the run"]') && !document.querySelector('[aria-label="Transcript"] .bounce')`, "the run ends", 30000);
  /** One live line, where it is expected and saying what is expected. */
  async function oneLine(what, { inBlock, says }) {
    const lines = await live();
    assert.equal(lines.length, 1, `${what}: one live line, not ${JSON.stringify(lines)}`);
    assert.equal(lines[0].inBlock, inBlock, `${what}: ${inBlock ? "in the step's own row" : "a line of its own"}`);
    assert.match(lines[0].text, says, what);
  }

  async function run() {
    await import("../out/main/index.js");
    for (let t = 0; t < 200 && !win; t++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));

    // Two calls running: their block is the live line, and the composer stops or steers.
    script.push({ text: "Checking.", tools: [waitsFor("a"), waitsFor("b")] }, { text: "Both done." });
    await send("run both");
    await until(`document.querySelectorAll('[aria-label="Transcript"] .bounce').length && /running 2 tools/.test(document.querySelector('[aria-label="Transcript"]').innerText)`, "two calls running");
    await oneLine("two calls running", { inBlock: true, says: /running 2 tools/ });
    assert.doesNotMatch(await transcript(), /ran 2 commands/, "nothing says they ran while they run");
    assert.equal(await button(), "Stop the run", "Stop with the field empty");
    await type("also the logs");
    await until(`!!document.querySelector('button[aria-label="Steer the run"]')`, "Steer once the field holds text");
    await type("");
    await until(`!!document.querySelector('button[aria-label="Stop the run"]')`, "Stop again once it is empty");
    release("a");
    await until(`!/running 2 tools/.test(document.querySelector('[aria-label="Transcript"]').innerText)`, "one call finished");
    await oneLine("the call left running", { inBlock: true, says: /running for .*gate-b/ });
    release("b");
    await until(`document.querySelector('[aria-label="Transcript"]').innerText.includes('Both done.')`, "the answer");
    await idle();
    assert.match(await transcript(), /ran 2 commands/, "finished, the block says what they did");

    // A lone call running is its own live line too.
    script.push({ tools: [waitsFor("c")] }, { text: "Lone done." });
    await send("run one");
    await until(`/gate-c/.test(document.querySelector('[aria-label="Transcript"] .bounce')?.parentElement.innerText ?? '')`, "a lone call running");
    await oneLine("a lone call running", { inBlock: true, says: /running for .*gate-c/ });
    release("c");
    await until(`document.querySelector('[aria-label="Transcript"]').innerText.includes('Lone done.')`, "its answer");
    await idle();

    // A thought being written is its own live line.
    const thought = deferred();
    script.push({ thinking: "Weighing the options.\nThe second one is ", hold: thought.promise, rest: "Thought through." });
    await send("think first");
    // Before the first word the status says `thinking` on its own line; the thought's own row takes it over.
    await until(`/Weighing the options/.test(document.querySelector('[aria-label="Transcript"] .bounce')?.parentElement.innerText ?? '')`, "a thought being written");
    await oneLine("a thought being written", { inBlock: true, says: /thinking Weighing the options\./ });
    thought.resolve();
    await until(`document.querySelector('[aria-label="Transcript"]').innerText.includes('Thought through.')`, "the answer after the thought");
    await idle();

    // An answer being written has no line under it.
    const answer = deferred();
    script.push({ text: "Half an answer", hold: answer.promise, rest: " and the rest." });
    await send("answer");
    await until(`document.querySelector('[aria-label="Transcript"]').innerText.includes('Half an answer')`, "an answer being written");
    assert.deepEqual(await live(), [], "the answer streaming is its own sign of life");
    answer.resolve();
    await idle();

    // A retry being waited out is said by one line, and once the run goes on, in the past above the answer.
    script.push({ status: 529 }, { text: "Answered after a retry." });
    await send("retry");
    await until(`/retrying 1\\/3/.test(document.querySelector('[aria-label="Transcript"] .bounce')?.parentElement.innerText ?? '')`, "a retry waited out");
    await oneLine("a retry waited out", { inBlock: false, says: /retrying 1\/3 the provider had a problem/ });
    assert.equal((await transcript()).match(/retrying 1\/3/g)?.length, 1, "said once, by the live line");
    await until(`document.querySelector('[aria-label="Transcript"]').innerText.includes('Answered after a retry.')`, "the answer after the retry", 30000);
    await idle();
    assert.match(await transcript(), /retried once: the provider had a problem/);
    assert.doesNotMatch(await transcript(), /retrying/, "no wait is left claimed");
    // A long conversation opens at its latest line at once, and its older lines are drawn above it while the view
    // stays where it is. Watched on every change to the page, so how fast the batches come does not matter.
    await evaluate(`(() => {
      const transcript = () => document.querySelector('[aria-label="Transcript"]');
      const has = (n) => transcript()?.innerText.includes('Turn ' + n + ' of the long one');
      window.__long = { first: undefined, moved: 0 };
      new MutationObserver(() => {
        const el = transcript();
        if (!el || !has(${LONG_TURNS})) return;
        if (window.__long.first === undefined) window.__long.first = has(1);
        window.__long.moved = Math.max(window.__long.moved, Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight));
      }).observe(document.body, { childList: true, subtree: true });
    })()`);
    await evaluate(`document.querySelector('aside button[aria-label="Long"]').click()`);
    await until(`document.querySelector('[aria-label="Transcript"]')?.innerText.includes('Turn 1 of the long one')`, "all of the long conversation drawn in the end");
    await new Promise((r) => setTimeout(r, 300));
    const { first, moved } = await evaluate("window.__long");
    assert.equal(first, false, "its latest turn is shown before its oldest is drawn");
    assert.ok(moved < 2, `the view stays at the latest line while older lines are drawn above it (it moved ${moved} px)`);
    assert.equal(script.length, 0, "every scripted answer was asked for");
    console.log("Transcript live end passed: calls, a lone call, a thought, an answer and a retry each one line; a long conversation opens at its end and fills in above it.");
  }

  const timeout = setTimeout(() => {
    console.error("Transcript check timed out");
    app.exit(1);
  }, 110000);
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      clearTimeout(timeout);
      server.close();
      for (const name of ["a", "b", "c"]) if (!existsSync(join(dir, `gate-${name}`))) release(name);
      app.exit(process.exitCode ?? 0);
    });
}
