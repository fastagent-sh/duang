/**
 * Screenshots of the real window, for looking at the design instead of describing it.
 *
 * Same isolation as the smoke check — a temporary agent, temporary credentials, a fake model
 * response — but it asserts nothing. It drives one conversation that contains every shape the
 * transcript has to draw, then writes `out/shots/{app,components}-{dark,light}.png`.
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

Three things follow from it:

- every section renders from one source of truth
- regeneration is per section, not per listing
- \`showRegenerateAll\` is a presentation flag, nothing more

Run \`bun run i18n:check\` before committing; it compares the twelve message files.`;

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
  const data = join(root, "user-data");
  app.setPath("userData", data);

  let win;

  async function run() {
    await mkdir(join(workspace, "fastagent"), { recursive: true });
    await mkdir(join(root, ".fastagent", ".secrets"), { recursive: true });
    await mkdir(join(data, "Shared Dictionary", "cache"), { recursive: true });
    process.env.HOME = root;
    for (const name of Object.keys(process.env)) {
      if (/API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i.test(name)) delete process.env[name];
    }
    const { GLOBAL_AUTH_PATH } = await import("@fastagent-sh/fastagent/pi");
    await writeFile(GLOBAL_AUTH_PATH, JSON.stringify({ openai: { type: "api_key", key: "shot-key" } }));
    await writeFile(join(workspace, "fastagent", "fastagent.config.ts"), 'export default { model: "openai/gpt-4o-mini" };\n');
    await writeFile(join(workspace, "hello.txt"), "Hello from the workspace\n");
    await writeFile(join(data, "agents.json"), JSON.stringify([{ id: "shot", name: "amazonseo.ai", dir: workspace }]));

    // Turn 1 reads a file, turn 2 fails a tool, turn 3 answers with the markdown above.
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      const item =
        requests === 1
          ? { id: "fc_1", type: "function_call", call_id: "call_1", name: "read", arguments: JSON.stringify({ path: join(workspace, "hello.txt") }) }
          : requests === 2
            ? { id: "fc_2", type: "function_call", call_id: "call_2", name: "bash", arguments: JSON.stringify({ command: "bun run i18n:check" }) }
            : { id: "msg", type: "message", role: "assistant", content: [{ type: "output_text", text: ANSWER, annotations: [] }] };
      const tool = requests < 3;
      const events = [
        { type: "response.created", response: { id: `resp_${requests}` } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) } },
        // Chunked on purpose: a fence is unclosed for most of the stream, which is where the
        // renderer's block detection actually gets tested.
        ...(tool ? [] : chunk(ANSWER, 40).map((delta) => ({ type: "response.output_text.delta", output_index: 0, delta }))),
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: `resp_${requests}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
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
      document.querySelector('button[aria-label="Send"]').click();
    })()`);
    await until("document.body.innerText.includes('sectionsGenerated')", "the answer");
    await until("document.querySelector('pre code span') !== null", "highlighting");

    await mkdir(fileURLToPath(new URL("../out/shots", import.meta.url)), { recursive: true });
    const capture = async (name) => {
      for (const theme of ["dark", "light"]) {
        nativeTheme.themeSource = theme;
        await new Promise((resolve) => setTimeout(resolve, 400));
        const image = await win.webContents.capturePage();
        const path = fileURLToPath(new URL(`../out/shots/${name}-${theme}.png`, import.meta.url));
        await writeFile(path, image.toPNG());
        console.log(path);
      }
    };
    await capture("app");

    // The component sheet, in the same window and the same build as the app it documents.
    // The sheet is a page, not a window: make the viewport tall enough to hold it in one image.
    win.setSize(1180, 1720);
    await evaluate("location.hash = '#gallery'");
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
