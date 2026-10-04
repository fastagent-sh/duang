import assert from "node:assert/strict";
import { test } from "node:test";
import { pickerModels } from "./catalog.ts";

const model = (spec: string, name?: string) => ({ spec, ...(name ? { name } : {}) }) as never;
const rows = (models: { spec: string; name?: string }[]) => models.map((m) => [m.spec, m.name]);

const catalog = [
  model("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5 (latest)"),
  model("anthropic/claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
  model("anthropic/claude-opus-5-5", "Claude Opus 5.5"),
  model("github-copilot/claude-haiku-4.5", "Claude Haiku 4.5 (latest)"),
  model("mistral/devstral-medium-latest", "Devstral 2 (latest)"),
  model("mistral/devstral-2512", "Devstral 2"),
  model("mistral/devstral-latest", "Devstral 2"),
  model("openai/gpt-5.5"),
];

test("an alias and its dated snapshot are one row, and (latest) goes where the name stays unique", () => {
  assert.deepEqual(rows(pickerModels(catalog)), [
    ["anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"],
    ["anthropic/claude-opus-5-5", "Claude Opus 5.5"],
    ["github-copilot/claude-haiku-4.5", "Claude Haiku 4.5"],
    // Another row is already "Devstral 2": "(latest)" is what tells this one apart, so it stays.
    ["mistral/devstral-medium-latest", "Devstral 2 (latest)"],
    ["mistral/devstral-2512", "Devstral 2"],
    ["mistral/devstral-latest", "Devstral 2"],
    ["openai/gpt-5.5", undefined],
  ]);
});

test("a snapshot the conversation runs on stays listed, named with its date beside its alias", () => {
  const listed = rows(pickerModels(catalog, "anthropic/claude-sonnet-4-5-20250929")).filter(([spec]) => spec!.startsWith("anthropic/claude-sonnet"));
  assert.deepEqual(listed, [
    ["anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"],
    ["anthropic/claude-sonnet-4-5-20250929", "Claude Sonnet 4.5 (2025-09-29)"],
  ]);
  // A dated model with no alias in the list is the only way to run it, under its own name.
  assert.deepEqual(rows(pickerModels([model("openai/gpt-4o-2024-08-06"), model("x/m-20250101", "M")])), [
    ["openai/gpt-4o-2024-08-06", undefined],
    ["x/m-20250101", "M"],
  ]);
});
