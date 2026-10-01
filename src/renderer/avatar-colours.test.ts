import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarGradient, GRADIENT, PALETTE } from "./avatar-colours.ts";

type Lch = readonly [number, number, number];
const lab = ([l, c, h]: Lch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const;
const distance = (a: Lch, b: Lch) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!) as [number, number, number]);
/** OKLCH to linear sRGB (Ottosson), unclamped: a value outside 0..1 means the colour is outside the gamut. */
function linear([l, c, h]: Lch) {
  const [, a, b] = lab([l, c, h]);
  const [x, y, z] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3) as [number, number, number];
  return [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z] as const;
}
const inGamut = (c: Lch) => linear(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const contrastWithWhite = (c: Lch) => {
  const [r, g, b] = linear(c);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
};

const top = ([l, c, h]: readonly [number, number, number]): Lch => [l + GRADIENT.lightness, c, h];
const middle = ([l, c, h]: readonly [number, number, number]): Lch => [l, c, h + GRADIENT.hue / 2];
const bottom = ([l, c, h]: readonly [number, number, number]): Lch => [l - GRADIENT.lightness, c * GRADIENT.chroma, h + GRADIENT.hue];

test("no two avatar colours are close enough to be taken for each other", () => {
  let closest = Infinity;
  for (const [i, a] of PALETTE.entries())
    for (const b of PALETTE.slice(i + 1)) closest = Math.min(closest, distance(middle(a), middle(b)));
  // About 0.02 is the least anyone notices and 0.1 is "different colours"; the palette this replaced had 0.060.
  assert.ok(closest >= 0.1, `the closest pair of colours is ${closest.toFixed(3)} apart in OKLab`);
});

test("white initials can be read on every stop of every gradient, and every stop is a colour sRGB has", () => {
  for (const colour of PALETTE) {
    assert.ok(inGamut(top(colour)) && inGamut(middle(colour)) && inGamut(bottom(colour)), `${colour} leaves sRGB, where the browser would quietly change it`);
    assert.ok(contrastWithWhite(top(colour)) >= 3, `${colour}: its light end is ${contrastWithWhite(top(colour)).toFixed(1)}:1 under white`);
    assert.ok(contrastWithWhite(middle(colour)) >= 4, `${colour}: its middle is ${contrastWithWhite(middle(colour)).toFixed(1)}:1 under white`);
  }
});

test("a name has one gradient, names that hash to neighbours do not get neighbouring colours, and every colour is used", () => {
  assert.equal(avatarGradient("amazonseo.ai"), avatarGradient("amazonseo.ai"), "the same agent is the same avatar");
  const hues = (names: string[]) => names.map((n) => /oklch\([\d. ]+ ([\d.]+) (\d+)\)/.exec(avatarGradient(n))![2]);
  const run = hues(["agent1", "agent2", "agent3", "agent4"]);
  assert.equal(new Set(run).size, 4, `four sequential names all differ: ${run}`);
  const used = new Set<string>();
  for (let i = 0; i < 400; i++) used.add(avatarGradient(`agent-${i}`));
  assert.equal(used.size, PALETTE.length, "every colour of the palette is reachable");
});
