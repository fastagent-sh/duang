/**
 * What the end-to-end scripts share: running a script again inside Electron over a throwaway root, keeping the
 * developer's credentials and proxy out of the run, and a local OpenAI-compatible model to point an agent at.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

/** Names that may carry a developer's credentials, their FastAgent or pi setup, or their proxy. */
const PRIVATE = /API_KEY|TOKEN|SECRET|^FASTAGENT_|^AWS_|^GOOGLE_|^AZURE_|^PI_|PROXY$/i;

/** `env` without anything `PRIVATE` names, changed in place (pass `process.env` to clean this process). */
export function withoutCredentials(env) {
  for (const name of Object.keys(env)) if (PRIVATE.test(name)) delete env[name];
  return env;
}

/**
 * Run from Node, runs `script` again inside Electron with a new temporary root (as its HOME too, unless `home` is
 * false), sets the exit code from it, removes the root and resolves undefined. `prepare` fills the root first.
 * Inside Electron, resolves that root. The root goes only after Electron has exited, so Chromium has stopped
 * writing its disk caches into it.
 */
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

/** One server-sent chunk of an OpenAI chat completion stream. */
export const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** Points the agent in `dir` (its `fastagent/` inside) at a local model `mock/mock` on `port`; `model` adds to its entry. */
export function writeMockModels(dir, port, model = {}) {
  writeFileSync(
    join(dir, "fastagent", "models.json"),
    JSON.stringify({
      providers: { mock: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "mock", models: [{ id: "mock", ...model }] } },
    }),
  );
}
