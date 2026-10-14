// Keeps the developer's credentials and proxy out of every end-to-end run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const PRIVATE = /API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i;

const ROOT = join(import.meta.dirname, "..");
// What `npm run build` reads. A dependency or lockfile change needs `npm ci` as well, which no freshness check can see.
const SOURCES = ["src", "electron.vite.config.ts", "tsconfig.json"];
const BUILT = ["out/main/index.js", "out/preload/index.mjs", "out/renderer/index.html"];

function newestMtime(target, root) {
  const full = join(root, target);
  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (stat.isFile()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(full, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    newest = Math.max(newest, statSync(join(entry.parentPath ?? entry.path, entry.name)).mtimeMs);
  }
  return newest;
}

/**
 * Refuses when the build the scripts load is older than the sources. A stale bundle answers for code nobody
 * ran: a smoke run against a stale `out/` was reported as a passing verification once, and cost a second look
 * to notice. `outputs` and `how` are for `packaged.mjs`, which loads the packaged app instead.
 */
export function requireFreshBuild(outputs = BUILT, how = "npm run build") {
  const newest = Math.max(...SOURCES.map((source) => newestMtime(source, ROOT)));
  const oldest = Math.min(
    ...outputs.map((output) => statSync(resolve(ROOT, output), { throwIfNoEntry: false })?.mtimeMs || 0),
  );
  if (oldest > newest) return;
  throw new Error(
    `${outputs[0]} is missing or older than ${SOURCES.join(", ")}: run \`${how}\` first.\n` +
      "These scripts load the built app, so a stale build answers about code that is not in it.",
  );
}

export function withoutCredentials(env) {
  for (const name of Object.keys(env)) if (PRIVATE.test(name)) delete env[name];
  return env;
}

// The root goes only after Electron exited, so Chromium has stopped writing its caches into it.
export async function isolated(script, { name, timeout, home = true, prepare }) {
  if (process.versions.electron) {
    const root = process.env.DUANG_TEST_ROOT;
    if (!root) throw new Error(`Run with node tests/${name}.mjs so the fixture is isolated`);
    return root;
  }
  const root = mkdtempSync(join(tmpdir(), `duang-${name}-`));
  try {
    // Before the fixture, so a stale build fails in a second rather than after a launch and a fake run.
    requireFreshBuild();
    await prepare?.(root);
    const child = spawnSync(electron, [fileURLToPath(script)], {
      stdio: "inherit",
      env: { ...process.env, DUANG_TEST_ROOT: root, ...(home ? { HOME: root } : {}) },
      timeout,
    });
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return undefined;
}

export const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

export function writeMockModels(dir, port, model = {}) {
  writeFileSync(
    join(dir, "fastagent", "models.json"),
    JSON.stringify({
      providers: { mock: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "mock", models: [{ id: "mock", ...model }] } },
    }),
  );
}
