/**
 * Screenshots of the real window, for looking at the design instead of describing it.
 *
 * Same isolation as the smoke check — temporary agents, temporary credentials, a fake model
 * response — but it asserts nothing. It drives one conversation that contains every shape the
 * transcript has to draw, then writes dark and light shots of the result, trace, narrow window,
 * sidebar, model picker, settings and component gallery to `out/shots/`.
 *
 *   npm run shots && open out/shots/app-dark.png
 */
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const ANSWER = `Here is what the \`ListingResult\` component does, and the part worth changing.

## The assembly

It owns four sections and decides which of them exist yet. The interesting line is \`sectionsGenerated\`, because everything downstream reads it.

\`\`\`tsx
export function ListingResult({ generatedListing, workflowPhase, onCopy }: ListingResultProps) {
  const t = useTranslations("AmazonListing");
  const sectionsGenerated = {
    title: !!generatedListing?.title,
    bulletPoints: !!generatedListing?.bulletPoints?.length,
  };
  return <section className="listing">{t("heading")}</section>;
}
\`\`\`

| Section | Source | Regenerates |
|---|---|---|
| Title | \`generatedListing.title\` | per section |
| Bullets | \`bulletPoints[]\` | per section |
| Keywords | backend | never |

Three things follow from it:

- every section renders from one source of truth
- regeneration is per section, not per listing
- \`showRegenerateAll\` is a presentation flag, nothing more

## 中文排版

**1. 缺少翻译键** \`ListingResult\` 用到的 \`heading\` 在 \`zh.json\` 里不存在：检查脚本按 \`AmazonListing\` 命名空间查找，找不到就报错。补上这个键（或者改用 \`title\`）之后再跑一次 i18n 检查，3 个 section 都会通过。

The i18n check failed. Open the tool call above for the exact diagnostic before committing.`;

const THOUGHTS = [
  "Start by reading the file they pointed at; everything else depends on what is actually in it.",
  "Now the i18n check. If the script is missing this fails fast, which is still an answer.",
  `The user wants three things: read the file, run the i18n check, and explain ListingResult.
The check is going to fail — there is no such script in this workspace — so the explanation should
stand on its own rather than depend on the check's output.`,
];

const chunk = (text, size) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

if (!process.versions.electron) {
  const root = mkdtempSync(join(tmpdir(), "duang-shot-"));
  try {
    const child = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, DUANG_SHOT_ROOT: root, HOME: root },
      timeout: 120000,
    });
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const { app, nativeTheme } = electron;
  const root = process.env.DUANG_SHOT_ROOT;
  const workspace = join(root, "project");
  const second = join(root, "compass");
  const data = join(root, "user-data");
  app.setPath("userData", data);

  let win;

  async function run() {
    await mkdir(join(workspace, "fastagent"), { recursive: true });
    await mkdir(join(second, "fastagent"), { recursive: true });
    await mkdir(join(root, ".fastagent", ".secrets"), { recursive: true });
    await mkdir(join(data, "Shared Dictionary", "cache"), { recursive: true });
    process.env.HOME = root;
    for (const name of Object.keys(process.env)) {
      if (/API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i.test(name)) delete process.env[name];
    }
    // duang reads only its own credential file, in its user data.
    await writeFile(join(data, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "shot-key" } }));
    await writeFile(join(workspace, "fastagent", "fastagent.config.ts"), 'export default { model: "openai/gpt-4o-mini" };\n');
    // Skills are what the composer's `/` completion lists.
    for (const [name, description] of [
      ["review", "Review a change for correctness and over-engineering before it is merged."],
      ["release-notes", "Write the release notes for everything merged since the last tag."],
      ["translate", "Translate a document and keep its formatting."],
      ["summarize", "Summarize a long thread into the decisions and the open questions."],
      ["triage", "Sort new issues by severity and propose an owner for each."],
      ["changelog", "Draft a changelog entry from the commits on this branch."],
      ["explain", "Explain a piece of code to someone who has not seen it."],
      ["migrate", "Plan a migration and list what breaks on the way."],
      ["outline", "Outline a document before it is written."],
    ]) {
      await mkdir(join(workspace, "fastagent", "skills", name), { recursive: true });
      await writeFile(join(workspace, "fastagent", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nDo ${name}.\n`);
    }
    await writeFile(join(workspace, "hello.txt"), "Hello from the workspace\n");
    await writeFile(join(second, "fastagent", "fastagent.config.ts"), 'export default { model: "openai/gpt-4o-mini" };\n');
    await writeFile(join(data, "agents.json"), JSON.stringify([
      { id: "shot", name: "amazonseo.ai", dir: workspace },
      { id: "shot-2", name: "compass", dir: second },
    ]));

    // Turn 1 reads a file, turn 2 says what it found and fails a tool, turn 3 answers with the
    // markdown above. The words between two calls are the text-to-work spacing §8 is about.
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      // Settings checks a different host; do not consume a model turn or touch the real network.
      if (input === "https://api.anthropic.com" && init?.method === "HEAD") return new Response(null, { status: 200 });
      requests++;
      const item =
        requests === 1
          ? { id: "fc_1", type: "function_call", call_id: "call_1", name: "read", arguments: JSON.stringify({ path: join(workspace, "hello.txt") }) }
          : requests === 2
            ? { id: "fc_2", type: "function_call", call_id: "call_2", name: "bash", arguments: JSON.stringify({ command: "bun run i18n:check" }) }
            : { id: "msg", type: "message", role: "assistant", content: [{ type: "output_text", text: ANSWER, annotations: [] }] };
      const tool = requests < 3;
      // Every turn reasons first, so the transcript carries a real run of thinking-and-tool lines:
      // that alternation is the rhythm §8 is about, and one tool call on its own never shows it. A
      // reasoning item has to open its own output slot before its deltas mean anything.
      const thought = THOUGHTS[requests - 1];
      const reasoning = { id: `rs_${requests}`, type: "reasoning", summary: [{ type: "summary_text", text: thought }] };
      const say =
        requests === 2
          ? { id: "msg_2", type: "message", role: "assistant", content: [{ type: "output_text", text: "The file is one line, so the component lives elsewhere. Running the i18n check next.", annotations: [] }] }
          : undefined;
      const index = say ? 2 : 1;
      const events = [
        { type: "response.created", response: { id: `resp_${requests}` } },
        { type: "response.output_item.added", output_index: 0, item: { ...reasoning, summary: [] } },
        ...chunk(thought, 30).map((delta) => ({ type: "response.reasoning_summary_text.delta", output_index: 0, delta })),
        { type: "response.output_item.done", output_index: 0, item: reasoning },
        ...(say
          ? [
              { type: "response.output_item.added", output_index: 1, item: { ...say, content: [] } },
              { type: "response.output_text.delta", output_index: 1, delta: say.content[0].text },
              { type: "response.output_item.done", output_index: 1, item: say },
            ]
          : []),
        { type: "response.output_item.added", output_index: index, item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) } },
        // Chunked on purpose: a fence is unclosed for most of the stream, which is where the
        // renderer's block detection actually gets tested.
        ...(tool ? [] : chunk(ANSWER, 40).map((delta) => ({ type: "response.output_text.delta", output_index: index, delta }))),
        { type: "response.output_item.done", output_index: index, item },
        {
          type: "response.completed",
          response: {
            id: `resp_${requests}`,
            status: "completed",
            output: [reasoning, ...(say ? [say] : []), item],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ];
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    };

    const loaded = new Promise((resolve) => {
      app.once("browser-window-created", (_event, window) => {
        win = window;
        win.webContents.once("did-finish-load", resolve);
      });
    });
    await import("../out/main/index.js");
    await loaded;
    win.setSize(1180, 860);

    const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
    const until = async (expression, what) => {
      for (let i = 0; i < 400; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${what}`);
    };

    await until("document.querySelector('textarea') && !document.querySelector('textarea').disabled", "composer");
    await evaluate(`(() => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '读一下这个文件, 跑一次 i18n 检查, 然后解释 ListingResult 的核心部分');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until("document.querySelector('button[aria-label=\"Send\"]') !== null", "Send appears for a draft");
    await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
    await until("document.body.innerText.includes('sectionsGenerated')", "the answer");
    await until("document.querySelector('pre code span') !== null", "highlighting");

    await mkdir(fileURLToPath(new URL("../out/shots", import.meta.url)), { recursive: true });
    const capture = async (name, position = "bottom") => {
      for (const theme of ["dark", "light"]) {
        nativeTheme.themeSource = theme;
        await new Promise((resolve) => setTimeout(resolve, 400));
        // After the theme has settled, not before: switching it relays out the highlighted code and
        // moves the bottom out from under a scroll position taken earlier.
        await evaluate(`(() => {
          const box = document.querySelector('[aria-label="Transcript"]');
          if (box) box.scrollTop = ${position === "top" ? "0" : "box.scrollHeight"};
        })()`);
        // Keep the pointer off the roster so an idle agent is not mistaken for the selected one.
        win.webContents.sendInputEvent({ type: "mouseMove", x: 20, y: 410 });
        const image = await win.webContents.capturePage();
        const path = fileURLToPath(new URL(`../out/shots/${name}-${theme}.png`, import.meta.url));
        await writeFile(path, image.toPNG());
        console.log(path);
      }
    };
    // The work block open, and the failed call inside it: expanded arguments and output are a state
    // the transcript draws, and a sheet of closed rows never shows it.
    const failedCall = `[...document.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.includes('i18n:check'))`;
    await evaluate(`document.querySelector('details').open = true; ${failedCall}.open = true`);
    // The live tail is the view people actually sit in, so that is what the shot shows. The printed
    // number is the clearance between the last line and the composer (App.tsx `bottomGap`).
    console.log(
      "clearance above composer:",
      await evaluate(`(() => {
        const box = document.querySelector('[aria-label="Transcript"]');
        box.scrollTop = box.scrollHeight;
        const last = box.querySelector('.column').lastElementChild;
        const composer = document.querySelector('.composer');
        return Math.round(composer.getBoundingClientRect().top - last.getBoundingClientRect().bottom);
      })()`),
    );
    await capture("app");
    // The `/` list: the same surface and rows as the model picker.
    await evaluate(`(() => { const i = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(i, '/'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`document.querySelector('.composer .popover button')`, "the command list");
    // The cursor at the last row of a list that scrolls: the row is brought fully into view.
    await evaluate(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await capture("commands");
    await evaluate(`(() => { const i = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!document.querySelector('.composer .popover button')`, "the command list closes");
    await evaluate(`document.querySelector('details').open = false`);
    await capture("app-start", "top");
    // Wide enough that the column stops growing: where its centring and its edges against the
    // composer actually show.
    win.setSize(1500, 1040);
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log("wide column edges vs composer:", await evaluate(`(() => { const a = document.querySelector('[aria-label="Transcript"] .column').getBoundingClientRect(); const b = document.querySelector('.composer').getBoundingClientRect(); return [a.left - b.left, a.right - b.right, a.width].join(","); })()`));
    await capture("app-wide");
    win.setSize(820, 660);
    await capture("app-narrow");
    win.setSize(1180, 860);
    await evaluate(`document.querySelector('main > header button[title="Conversations"]').click()`);
    await until(`document.querySelector('#conversations:popover-open')`, "conversation list");
    await capture("app-conversations");
    await evaluate(`document.querySelector('#conversations').hidePopover()`);
    await evaluate(`document.querySelector('button[title^="Model for this agent"]').click()`);
    await until(`document.querySelector('dialog[open]')`, "model picker");
    await capture("models");
    // A model that thinks in levels: the effort track appears under the list.
    await evaluate(`document.querySelector('dialog button[data-model="openai/gpt-5"]').click()`);
    await until(`!document.querySelector('dialog') && document.querySelector('button[title^="Model for this agent"]')?.textContent.includes('gpt-5')`, "a reasoning model chosen");
    await evaluate(`document.querySelector('button[title^="Model for this agent"]').click()`);
    await until(`document.querySelector('dialog [role=radiogroup]')`, "the effort track");
    await evaluate(`document.querySelector('dialog [role=radio][aria-label="Medium"]').click()`);
    await until(`document.querySelector('dialog [role=radio][aria-label="Medium"]').getAttribute('aria-checked') === 'true'`, "a middle level chosen");
    await capture("models-effort");
    await evaluate(`document.querySelector('dialog').close()`);

    // Reopened, the conversation is history: nothing in it arrived just now, so nothing in it may
    // float in as if it had. Printed rather than asserted, like the clearance above — and 0 is the
    // only right answer.
    const reopened = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await reopened;
    await until("document.body.innerText.includes('sectionsGenerated')", "the reopened conversation");
    console.log("rows animating in on reopen:", await evaluate(`document.querySelectorAll('.column > .enter').length`));
    await until(`document.querySelector('button[title="New conversation (⌘N)"]')`, "new conversation control");
    await evaluate(`document.querySelector('button[title="New conversation (⌘N)"]').click()`);
    await until(`document.body.innerText.includes('What should we work on?')`, "new conversation");
    await capture("new-conversation");
    await evaluate(`document.querySelector('button[title="Settings (⌘,)"]').click()`);
    await until(`document.querySelector('[role="radio"]')`, "network choices");
    // A direct, mocked connection is deterministic even on machines with a system proxy.
    await evaluate(`[...document.querySelectorAll('[role="radio"]')].find((row) => row.textContent.startsWith('Off')).click()`);
    await until(`document.body.innerText.includes('connected ·')`, "mocked network check");
    await capture("settings");
    // The avatar styles, each showing itself.
    await evaluate(`document.querySelector('#appearance-heading').scrollIntoView({ block: "start" })`);
    await capture("settings-avatars", "keep");

    // The component sheet, in the same window and the same build as the app it documents.
    // The sheet is a page, not a window: make the viewport tall enough to hold it in one image.
    win.setSize(1180, 2000);
    // Changing only the fragment is an in-page navigation — the document, and the hash the app read
    // at startup, stay as they were. The reload is what makes it a real load.
    await win.loadURL(`${win.webContents.getURL().split("#")[0]}#gallery`);
    const reloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await reloaded;
    await until("document.body.innerText.includes('components')", "the gallery");
    await until("document.querySelector('pre code span') !== null", "gallery highlighting");
    await capture("components");
  }

  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      if (win && !win.isDestroyed()) win.destroy();
      app.exit(process.exitCode ?? 0);
    });
}
