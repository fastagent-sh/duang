/**
 * An agent's avatar colour, from its name, so the same agent is the same avatar everywhere.
 *
 * Ten colours picked to be told apart at a glance: the closest pair is 0.104 apart in OKLab, where about
 * 0.02 is the least anyone notices and 0.1 is "different colours" (the seven this replaced had a closest
 * pair of 0.060, and two muddy ones, an olive and a brown). Each is `[lightness, chroma, hue]` at the
 * gradient's middle: the gradient runs 0.09 lighter to 0.09 darker and 12° round the hue. White initials
 * sit on it, so the light end must reach 3:1 and the middle 4:1, and every stop must be inside sRGB
 * (`avatar-colours.test.ts` holds all of that, so a colour added later cannot repeat one already here).
 * Chroma is capped at 0.15, which keeps the roster calm beside the rest of the palette.
 */
export const PALETTE = [
  [0.57, 0.15, 8], // rose
  [0.46, 0.126, 28], // brick
  [0.57, 0.114, 56], // ochre
  [0.46, 0.114, 124], // forest
  [0.57, 0.142, 124], // lime
  [0.46, 0.114, 244], // navy
  [0.57, 0.15, 252], // azure
  [0.5, 0.15, 284], // indigo
  [0.57, 0.15, 316], // orchid
  [0.46, 0.15, 324], // plum
] as const satisfies readonly (readonly [number, number, number])[];

/** How far the gradient reaches either way from the palette's lightness, and how it turns. */
export const GRADIENT = { lightness: 0.09, chroma: 0.92, hue: 12 } as const;

export function avatarGradient(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) % 9973;
  // Three apart, so names that hash to neighbours (agent1, agent2) land on colours a third of the wheel away.
  const [l, c, h] = PALETTE[(hash * 3) % PALETTE.length]!;
  const top = `oklch(${(l + GRADIENT.lightness).toFixed(3)} ${c} ${h})`;
  const bottom = `oklch(${(l - GRADIENT.lightness).toFixed(3)} ${+(c * GRADIENT.chroma).toFixed(3)} ${h + GRADIENT.hue})`;
  // The gradient is Telegram's, and it is most of why their avatars look alive rather than printed.
  return `linear-gradient(145deg, ${top}, ${bottom})`;
}
