import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarGradient, avatarHex, GRADIENT, INK, linearSrgb, PALETTE } from "./avatar-colours.ts";

type Lch = readonly [number, number, number];
const lab = ([l, c, h]: Lch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const;
const distance = (a: Lch, b: Lch) => Math.hypot(...(lab(a).map((v, i) => v - lab(b)[i]!) as [number, number, number]));
const linear = linearSrgb;
const inGamut = (c: Lch) => linear(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const luminance = (c: Lch) => {
  const [r, g, b] = linear(c).map((v) => gamma(Math.max(0, Math.min(1, v)))) as [number, number, number];
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ink: Lch = (() => {
  const [l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(INK)!.slice(1).map(Number) as [number, number, number];
  return [l, c, h];
})();
const contrastWithInk = (c: Lch) => (luminance(c) + 0.05) / (luminance(ink) + 0.05);

const top = ([l, c, h]: readonly [number, number, number]): Lch => [l + GRADIENT.lightness, c, h];
const middle = ([l, c, h]: readonly [number, number, number]): Lch => [l, c, h + GRADIENT.hue / 2];
const bottom = ([l, c, h]: readonly [number, number, number]): Lch => [l - GRADIENT.lightness, c * GRADIENT.chroma, h + GRADIENT.hue];

test("no two avatar colours are close enough to be taken for each other", () => {
  let closest = Infinity;
  for (const [i, a] of PALETTE.entries())
    for (const b of PALETTE.slice(i + 1)) closest = Math.min(closest, distance(middle(a), middle(b)));
  // About 0.02 is the least anyone notices and 0.1 is "different colours".
  assert.ok(closest >= 0.09, `the closest pair of colours is ${closest.toFixed(3)} apart in OKLab`);
});

test("the initials can be read on every gradient, and every stop is a colour sRGB has", () => {
  for (const colour of PALETTE) {
    assert.ok(inGamut(top(colour)) && inGamut(middle(colour)) && inGamut(bottom(colour)), `${colour} leaves sRGB, where the browser would quietly change it`);
    assert.ok(contrastWithInk(middle(colour)) >= 4.5, `${colour}: its middle is ${contrastWithInk(middle(colour)).toFixed(1)}:1 under the initials`);
    assert.ok(contrastWithInk(bottom(colour)) >= 3, `${colour}: its darkest stop is ${contrastWithInk(bottom(colour)).toFixed(1)}:1 under the initials`);
  }
});

test("agents numbered one after another get different, far-apart colours, and every colour is reached", () => {
  const gradients = Array.from({ length: PALETTE.length }, (_, colour) => avatarGradient(colour));
  assert.equal(new Set(gradients).size, PALETTE.length, "the first sixteen agents are all different");
  assert.equal(avatarGradient(PALETTE.length), avatarGradient(0), "after that the palette repeats");
  // Next-door numbers must not be next-door colours: a roster is mostly agents added one after another.
  const at = (colour: number) => /oklch\([\d.]+ [\d.]+ (\d+)\)/.exec(avatarGradient(colour))![1]!;
  for (let colour = 0; colour < 4; colour++) {
    const apart = Math.abs(Number(at(colour)) - Number(at(colour + 1)));
    assert.ok(Math.min(apart, 360 - apart) >= 60, `agents ${colour} and ${colour + 1} are only ${apart}° apart in hue`);
  }
});

test("an agent's solid colour is its palette entry, written as hex", () => {
  assert.match(avatarHex(0), /^#[0-9a-f]{6}$/);
  assert.notEqual(avatarHex(0), avatarHex(1), "next-door agents differ");
  assert.equal(avatarHex(PALETTE.length), avatarHex(0), "and the palette repeats where the gradient's does");
  // rose, the first entry, is a light warm pink: red over green over blue, all of them high.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(avatarHex(0).slice(i, i + 2), 16)) as [number, number, number];
  assert.ok(r > g && r > b && b > 150, `rose is ${avatarHex(0)}`);
});
