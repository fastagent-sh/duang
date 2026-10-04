import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPiAgentFromDir } from "@fastagent-sh/fastagent/pi";
import { AgentRegistry, createAgentIn, failingConfig, freshConfig, MissingDirError, requireFolder } from "./agent-files.ts";

test("registry serializes writes in one process, survives restart and deduplicates real paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const file = join(root, "data", "agents.json");
    const registry = new AgentRegistry(file);
    const a = join(root, "a"),
      b = join(root, "b"),
      alias = join(root, "alias");
    await Promise.all([mkdir(a), mkdir(b)]);
    await symlink(a, alias);
    assert.deepEqual(await registry.list(), []);
    const [first, second] = await Promise.all([registry.add(a), registry.add(b)]);
    assert.equal((await registry.add(alias)).id, first.id);
    await Promise.all([
      registry.setModel(first.id, "provider/model"),
      registry.rename(first.id, "Reviewer"),
      registry.remove(second.id),
    ]);
    await assert.rejects(registry.rename(second.id, "gone"), /unknown agent/);
    const restarted = new AgentRegistry(file);
    assert.deepEqual(await restarted.list(), [{ ...first, name: "Reviewer", model: "provider/model" }]);
    assert.deepEqual(await readdir(join(root, "data")), ["agents.json"]);
    await restarted.remove(first.id);
    assert.deepEqual(await restarted.list(), []);
    assert.deepEqual(await readdir(a), [], "removal leaves the project alone");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("each agent has a colour: the lowest one free, kept for its life, reused once it is free again", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const registry = new AgentRegistry(join(root, "agents.json"));
    const dirs = await Promise.all(["a", "b", "c", "d"].map(async (name) => {
      await mkdir(join(root, name));
      return join(root, name);
    }));
    const [a, b, c] = [await registry.add(dirs[0]!), await registry.add(dirs[1]!), await registry.add(dirs[2]!)];
    assert.deepEqual([a.colour, b.colour, c.colour], [0, 1, 2], "no two agents share one while the palette lasts");
    await registry.rename(b.id, "Renamed");
    assert.equal((await registry.list()).find((row) => row.id === b.id)!.colour, 1, "a rename does not recolour it");
    await registry.remove(b.id);
    assert.equal((await registry.add(dirs[3]!)).colour, 1, "a removed agent's colour is the next one's");
    assert.equal((await registry.list()).find((row) => row.id === a.id)!.colour, 0, "and the others keep theirs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every row names its colour, a whole number from zero; one without it is an invalid registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const file = join(root, "agents.json");
    for (const colour of [undefined, -1, 1.5, "3", null]) {
      const stored = JSON.stringify([{ id: "x", name: "X", dir: "/tmp/x", ...(colour === undefined ? {} : { colour }) }]);
      await writeFile(file, stored);
      await assert.rejects(new AgentRegistry(file).list(), /invalid agent registry/, `colour ${JSON.stringify(colour)}`);
      assert.equal(await readFile(file, "utf8"), stored, "and the file is left as it was");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid or unreadable registry fails visibly and is never replaced with an empty list", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const file = join(root, "agents.json");
    const registry = new AgentRegistry(file);
    for (const corrupt of ["{broken", "{}", '[{"id":"a","name":5,"dir":"/tmp"}]']) {
      await writeFile(file, corrupt);
      // Whatever is wrong, the message must name the file the person has to open.
      await assert.rejects(registry.list(), (error: Error) => error.message.startsWith(`${file}: `));
      await assert.rejects(registry.add(root));
      assert.equal(await readFile(file, "utf8"), corrupt);
    }
    await rm(file);
    await mkdir(file);
    await assert.rejects(registry.list());
    await rm(file, { recursive: true });
    assert.equal(
      (await registry.add(root)).dir,
      await realpath(root),
      "a failed write does not poison the write queue",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scaffolding creates only a new agent directory and never overwrites existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-scaffold-"));
  try {
    const dir = await createAgentIn(root);
    assert.equal(await readFile(join(dir, "fastagent.config.ts"), "utf8"), "export default {};\n");
    await writeFile(join(dir, "fastagent.config.ts"), "existing config");
    await assert.rejects(createAgentIn(root), { code: "EEXIST" });
    assert.equal(await readFile(join(dir, "fastagent.config.ts"), "utf8"), "existing config");
    await rm(dir, { recursive: true });
    await mkdir(dir);
    await assert.rejects(createAgentIn(root), { code: "EEXIST" });
    assert.deepEqual(await readdir(dir), [], "even an empty existing directory must remain untouched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a scaffold that cannot write its files leaves no directory behind", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores the permission bits this test relies on");
  const root = await mkdtemp(join(tmpdir(), "duang-scaffold-"));
  // A umask without the write bit makes the new directory read-only, so the first writeFile fails.
  const previous = process.umask(0o222);
  t.after(async () => {
    process.umask(previous);
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(createAgentIn(root), { code: "EACCES" });
  assert.deepEqual(await readdir(root), [], "a retry must not hit EEXIST on our own leftovers");
});

test("a moved folder is the same agent where it is now; a folder that is another agent is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const registry = new AgentRegistry(join(root, "agents.json"));
    const [before, after, other] = [join(root, "before"), join(root, "after"), join(root, "other")];
    await Promise.all([mkdir(before), mkdir(after), mkdir(other)]);
    const moved = await registry.add(before);
    const second = await registry.add(other);
    await registry.relocate(moved.id, after);
    assert.deepEqual(
      (await registry.list()).find((row) => row.id === moved.id),
      { ...moved, dir: await realpath(after) },
      "its id, name and colour are kept",
    );
    await assert.rejects(registry.relocate(moved.id, other), new RegExp(`already the agent "${second.name}"`));
    await assert.rejects(registry.relocate(moved.id, join(root, "nowhere")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh config replaces only the agent's own, and keeps the old one beside it, never over a copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-file-"));
  try {
    const dir = join(root, "agent");
    await mkdir(join(dir, "fastagent"), { recursive: true });
    const config = join(dir, "fastagent", "fastagent.config.ts");
    await writeFile(config, "export default { model: ,};\n");
    await writeFile(join(dir, "fastagent", "persona.ts"), "x");
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "fastagent.config.ts"), "outside");
    await symlink(join(root, "elsewhere"), join(dir, "linked"));

    await assert.rejects(freshConfig(dir, join(dir, "fastagent", "persona.ts")), /is not this agent's fastagent.config.ts/);
    await assert.rejects(freshConfig(dir, join(root, "elsewhere", "fastagent.config.ts")), /is not this agent's/);
    await assert.rejects(freshConfig(dir, join(dir, "linked", "fastagent.config.ts")), /is not this agent's/, "a link out of the folder");
    assert.equal(await readFile(join(root, "elsewhere", "fastagent.config.ts"), "utf8"), "outside");

    const at = new Date(2026, 9, 3, 14, 40, 0);
    await freshConfig(dir, config, at);
    const kept = join(dir, "fastagent", "fastagent.config.ts.broken-20261003-144000");
    assert.equal(await readFile(kept, "utf8"), "export default { model: ,};\n", "the person's file is kept as it was");
    assert.equal(await readFile(config, "utf8"), "export default {};\n");
    // A second reset in the same second (a double click) must not put the fresh file over the person's copy.
    await assert.rejects(freshConfig(dir, config, at), /EEXIST/);
    assert.equal(await readFile(kept, "utf8"), "export default { model: ,};\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a load that failed in the config is told apart by FastAgent's own words", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-config-"));
  const failure = async (name: string, files: Record<string, string>) => {
    const dir = join(root, name);
    for (const [file, text] of Object.entries(files)) {
      await mkdir(join(dir, "fastagent", file, ".."), { recursive: true });
      await writeFile(join(dir, "fastagent", file), text);
    }
    const error = await createPiAgentFromDir(dir, { sessionControl: true }).then(
      () => assert.fail(`${name} loaded`),
      (error: Error) => error.message,
    );
    return { message: error, config: join(dir, "fastagent", "fastagent.config.ts") };
  };
  try {
    // Each of these is gotten past by a fresh config, wherever the mistake is.
    const cases: Record<string, Record<string, string>> = {
      syntax: { "fastagent.config.ts": "export default {\n  model: ,\n};\n" },
      key: { "fastagent.config.ts": "export default { modle: 'x' };\n" },
      imported: { "fastagent.config.ts": "import t from './tools/t.ts';\nexport default { tools: [t] };\n", "tools/t.ts": "export default {;\n" },
      package: { "fastagent.config.ts": "import 'no-such-package-here';\nexport default {};\n" },
    };
    for (const [name, files] of Object.entries(cases)) {
      const { message, config } = await failure(name, files);
      assert.equal(failingConfig(message), config, `${name}: ${message}`);
    }
    assert.equal(failingConfig("missing model: set --model"), undefined);
    assert.equal(failingConfig("/x/fastagent/fastagent.config.ts.broken-1: nope"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only a folder that is not there is missing; one that cannot be looked at says why", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-folder-"));
  try {
    await assert.rejects(requireFolder(join(root, "gone")), (error) => error instanceof MissingDirError && /ENOENT/.test(error.message));
    await writeFile(join(root, "file"), "");
    await assert.rejects(requireFolder(join(root, "file", "inside")), MissingDirError);
    await mkdir(join(root, "locked", "agent"), { recursive: true });
    await chmod(join(root, "locked"), 0o000);
    await assert.rejects(
      requireFolder(join(root, "locked", "agent")),
      (error) => !(error instanceof MissingDirError) && /EACCES/.test(String(error)),
      "a permission problem is not a folder to go and locate",
    );
  } finally {
    await chmod(join(root, "locked"), 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
