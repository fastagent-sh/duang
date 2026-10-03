import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = await mkdtemp(join(tmpdir(), "duang-usage-"));
const auth = join(dir, "auth.json");
const { MIN_GAP_MS, forgetUsage, parseAnthropic, providerUsage } = await import("./usage.ts");

const HOUR = 3600;

test("the plan's shape parses, and a missing field is an error rather than zero", () => {
  assert.deepEqual(
    parseAnthropic({
      five_hour: { utilization: 4, resets_at: "2026-09-24T06:29:00Z" },
      seven_day: { utilization: 18, resets_at: null },
    }),
    [
      { label: "5h", percent: 4, resetsAt: Date.parse("2026-09-24T06:29:00Z"), windowSeconds: 5 * HOUR },
      { label: "7d", percent: 18, windowSeconds: 7 * 24 * HOUR },
    ],
  );
  assert.throws(() => parseAnthropic({ five_hour: { resets_at: null } }), /five_hour.utilization/);
  assert.throws(() => parseAnthropic({}), /neither five_hour nor seven_day/);
});

test("a subscription is read with its own token; an API key has no windows; a refusal keeps the provider's words", async () => {
  const calls: { url: string; authorization: string | null }[] = [];
  let status = 200;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return status === 200
      ? Response.json({ five_hour: { utilization: 4, resets_at: null }, seven_day: null })
      : new Response("rate limited", { status });
  };
  await writeFile(
    auth,
    JSON.stringify({
      anthropic: { type: "oauth", access: "sk-ant-oat01-test", refresh: "r", expires: Date.now() + 3_600_000 },
      openai: { type: "api_key", key: "sk-test" },
    }),
  );
  const t = Date.now();
  const first = await providerUsage("anthropic", auth, t);
  assert.deepEqual(first.windows, [{ label: "5h", percent: 4, windowSeconds: 5 * HOUR }]);
  assert.deepEqual(calls, [{ url: "https://api.anthropic.com/api/oauth/usage", authorization: "Bearer sk-ant-oat01-test" }]);

  // Within the gap the same answer is reused: a turn ending every minute must not poll a 429-prone route.
  assert.equal(await providerUsage("anthropic", auth, t + MIN_GAP_MS - 1), first);
  assert.equal(calls.length, 1);

  status = 429;
  await assert.rejects(providerUsage("anthropic", auth, t + MIN_GAP_MS), /api\.anthropic\.com answered 429: rate limited/);
  await writeFile(auth, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api03-test" } }));
  assert.equal((await providerUsage("anthropic", auth, t + 2 * MIN_GAP_MS)).windows, undefined, "an API key is not a plan");
  assert.equal((await providerUsage("mistral", auth, t)).windows, undefined, "a provider with no usage route");
  assert.equal(calls.length, 2, "neither asked the usage route");

  // Another file's login is another answer, even inside the gap.
  const other = join(dir, "other.json");
  await writeFile(other, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api03-other" } }));
  status = 200;
  const t2 = t + 10 * MIN_GAP_MS;
  assert.ok((await providerUsage("anthropic", auth, t2)).windows === undefined);
  await writeFile(
    other,
    JSON.stringify({ anthropic: { type: "oauth", access: "sk-ant-oat01-other", refresh: "r", expires: Date.now() + 3_600_000 } }),
  );
  assert.deepEqual((await providerUsage("anthropic", other, t2 + 1)).windows, [{ label: "5h", percent: 4, windowSeconds: 5 * HOUR }]);
  assert.equal(calls.at(-1)?.authorization, "Bearer sk-ant-oat01-other");

  // Reconnected inside the gap (an API key replaced by a subscription): the new login is read.
  await writeFile(
    auth,
    JSON.stringify({ anthropic: { type: "oauth", access: "sk-ant-oat01-new", refresh: "r", expires: Date.now() + 3_600_000 } }),
  );
  assert.equal((await providerUsage("anthropic", auth, t2 + 2)).windows, undefined, "still the key's answer until told");
  forgetUsage("anthropic", auth);
  assert.equal((await providerUsage("anthropic", auth, t2 + 3)).windows?.length, 1);
  assert.equal(calls.at(-1)?.authorization, "Bearer sk-ant-oat01-new");
});
