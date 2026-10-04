import assert from "node:assert/strict";
import { test } from "node:test";
import { pickerModels } from "./catalog.ts";

const model = (spec: string, name?: string) => ({ spec, ...(name ? { name } : {}) }) as never;

test("an alias and its dated snapshot are one row, named without (latest)", () => {
  const catalog = [
    model("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5 (latest)"),
    model("anthropic/claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    model("anthropic/claude-opus-5-5", "Claude Opus 5.5"),
    model("github-copilot/claude-haiku-4.5", "Claude Haiku 4.5 (latest)"),
    model("openai/gpt-5.5"),
  ];
  assert.deepEqual(
    pickerModels(catalog).map((m: { spec: string; name?: string }) => [m.spec, m.name]),
    [
      ["anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"],
      ["anthropic/claude-opus-5-5", "Claude Opus 5.5"],
      ["github-copilot/claude-haiku-4.5", "Claude Haiku 4.5"],
      ["openai/gpt-5.5", undefined],
    ],
  );
  // A snapshot the conversation runs on stays listed, so the picker shows what runs.
  assert.ok(pickerModels(catalog, "anthropic/claude-sonnet-4-5-20250929").some((m: { spec: string }) => m.spec === "anthropic/claude-sonnet-4-5-20250929"));
  // A dated model with no alias in the list is the only way to run it.
  assert.equal(pickerModels([model("openai/gpt-4o-2024-08-06"), model("x/m-20250101")]).length, 2);
});
