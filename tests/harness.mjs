// Keeps the developer's credentials and proxy out of every end-to-end run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const PRIVATE = /API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i;

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
