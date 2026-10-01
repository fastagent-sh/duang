/**
 * An agent's avatar colour. The registry gives each agent a number, once, and keeps it (so renaming an
 * agent does not recolour it, and two agents do not share a colour until there are more agents than
 * colours); this maps that number onto the palette.
 *
 * Sixteen bright colours, picked by a search for the widest spread that keeps dark initials readable:
 * the closest pair is 0.093 apart in OKLab, where about 0.02 is the least anyone notices and 0.1 is
 * "different colours". (The ten before were dark enough for white initials and read as shades of one
 * colour; the seven before that had a closest pair of 0.060 and a muddy olive and brown.) Brightness
 * and white initials cannot go together: white falls under 3:1 above a lightness of about 0.64, while
 * dark initials on the same colour are above 5:1, so these wear dark ones. Each entry is
 * `[lightness, chroma, hue]` at the gradient's middle; the gradient runs 0.09 lighter to 0.09 darker and
 * 12° round the hue. The middle must hold the initials at 4.5:1, the darkest stop at 3:1, and every stop
 * must be inside sRGB (`avatar-colours.test.ts` holds all of that, so a colour added later cannot repeat
 * one already here). Chroma is capped at 0.17 so the roster stays calm beside the rest of the palette.
 */
export const PALETTE = [
  [0.74, 0.098, 4], // rose
  [0.66, 0.155, 40], // coral
  [0.78, 0.09, 64], // sand
  [0.7, 0.136, 88], // gold
  [0.82, 0.168, 100], // lemon
  [0.74, 0.168, 120], // lime
  [0.66, 0.168, 136], // leaf
  [0.82, 0.168, 144], // mint
  [0.66, 0.108, 172], // sage
  [0.82, 0.133, 188], // aqua
  [0.74, 0.123, 220], // sky
  [0.66, 0.129, 256], // cornflower
  [0.74, 0.091, 292], // lilac
  [0.66, 0.167, 308], // orchid
  [0.74, 0.16, 328], // pink
  [0.66, 0.168, 352], // raspberry
] as const satisfies readonly (readonly [number, number, number])[];

/** The initials' colour: near-black, on every colour of the palette. */
export const INK = "oklch(0.22 0.01 285)";

/** How far the gradient reaches either way from an entry's lightness, and how it turns. */
export const GRADIENT = { lightness: 0.09, chroma: 0.92, hue: 12 } as const;

/**
 * Walked five at a time, so agents numbered one after another (0, 1, 2…) land on colours a third of the
 * wheel apart. Five and sixteen share no factor, so every colour is reached.
 */
const STEP = 5;

export function avatarGradient(colour: number): string {
  const [l, c, h] = PALETTE[(colour * STEP) % PALETTE.length]!;
  const top = `oklch(${(l + GRADIENT.lightness).toFixed(3)} ${c} ${h})`;
  const bottom = `oklch(${(l - GRADIENT.lightness).toFixed(3)} ${+(c * GRADIENT.chroma).toFixed(3)} ${h + GRADIENT.hue})`;
  // The gradient is Telegram's, and it is most of why their avatars look alive rather than printed.
  return `linear-gradient(145deg, ${top}, ${bottom})`;
}
