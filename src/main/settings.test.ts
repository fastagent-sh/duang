import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, network, proxyUrl, readSettings, writeSettings } from "./settings.ts";

test("only a missing file is a first run; an unreadable one names itself", async () => {
  const dir = await mkdtemp(join(tmpdir(), "duang-settings-"));
  const file = join(dir, "settings.json");
  assert.deepEqual(await readSettings(file), DEFAULTS);

  await writeFile(file, "{not json");
  await assert.rejects(readSettings(file), (error: Error) => error.message.startsWith(`${file}: `));
  await writeFile(file, JSON.stringify({ network: { mode: "manual", url: "ftp://x" } }));
  await assert.rejects(readSettings(file), /http:\/\/, https:\/\/ or socks5:\/\//);
  await writeFile(file, JSON.stringify({ network: { mode: "sometimes" } }));
  await assert.rejects(readSettings(file), /Unknown network mode: "sometimes"/);

  await writeSettings(file, { network: { mode: "manual", url: "socks5://127.0.0.1:7891" } });
  assert.deepEqual(await readSettings(file), { network: { mode: "manual", url: "socks5://127.0.0.1:7891" } });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).network.mode, "manual");
});

test("a proxy URL is normalised to scheme and host, and anything else is refused", () => {
  assert.equal(proxyUrl(" http://127.0.0.1:7890/ "), "http://127.0.0.1:7890");
  assert.equal(proxyUrl("socks5://127.0.0.1:7891"), "socks5://127.0.0.1:7891");
  assert.throws(() => proxyUrl(""), /needs a URL/);
  assert.throws(() => proxyUrl("127.0.0.1:7890"), /http:\/\/, https:\/\/ or socks5:\/\/|Not a URL/);
  assert.deepEqual(network({ mode: "off" }), { mode: "off" });
  assert.throws(() => network({ mode: "manual" }), /needs a URL/);
});
