import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentRegistry, createAgentIn } from "./agent-files.ts";

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

test("a row without a colour (hand-edited, or from before colours) is given the lowest free and keeps it", async () => {
  const root = await mkdtemp(join(tmpdir(), "duang-registry-"));
  try {
    const file = join(root, "agents.json");
    await writeFile(
      file,
      JSON.stringify([
        { id: "kept", name: "Kept", dir: "/tmp/kept", colour: 1 },
        { id: "old-a", name: "A", dir: "/tmp/a" },
        { id: "old-b", name: "B", dir: "/tmp/b" },
      ]),
    );
    const registry = new AgentRegistry(file);
    assert.deepEqual((await registry.list()).map((row) => [row.id, row.colour]), [["kept", 1], ["old-a", 0], ["old-b", 2]]);
    assert.deepEqual(
      JSON.parse(await readFile(file, "utf8")).map((row: { colour: number }) => row.colour),
      [1, 0, 2],
      "it is saved, so the next read gives the same answer",
    );
    assert.deepEqual((await new AgentRegistry(file).list()).map((row) => row.colour), [1, 0, 2]);
    for (const bad of [-1, 1.5, "3", null]) {
      await writeFile(file, JSON.stringify([{ id: "x", name: "X", dir: "/tmp/x", colour: bad }]));
      await assert.rejects(new AgentRegistry(file).list(), /invalid agent registry/, `colour ${JSON.stringify(bad)} is not a colour`);
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
