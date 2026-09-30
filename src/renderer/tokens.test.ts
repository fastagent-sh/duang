import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dir = new URL(".", import.meta.url).pathname;
const sources = readdirSync(dir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, lines: readFileSync(join(dir, name), "utf8").split("\n") }));

/** Every line of every component, with where it is. */
function* lines() {
  for (const { name, lines: all } of sources) for (const [index, text] of all.entries()) yield { at: `${name}:${index + 1}`, text };
}

// docs/ui.md §5. The chrome's sizes; the conversation's own (15, headings, tables) are set in index.css.
// Mono sits half a step above the sans beside it, since its x-height is smaller: 12.5, and only on mono.
const SIZES = new Set([11, 12, 13, 15, 22]);

test("chrome text is set on the size scale, and the half step only on mono", () => {
  const off: string[] = [];
  for (const { at, text } of lines())
    for (const [, size] of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      const px = Number(size);
      const mono = px === 12.5 && /font-mono/.test(text);
      if (!SIZES.has(px) && !mono) off.push(`${at}: ${px}px`);
    }
  assert.deepEqual(off, [], "sizes off the scale (docs/ui.md §5)");
});

test("corners come from the three radius tokens; a bubble's tail and inline code are the only 4", () => {
  const off: string[] = [];
  for (const { at, text } of lines())
    for (const [, radius] of text.matchAll(/rounded-(?:[a-z]+-)?\[(\d+)px\]/g)) if (radius !== "4") off.push(`${at}: ${radius}px`);
  assert.deepEqual(off, [], "arbitrary radii (docs/ui.md §7)");
});
