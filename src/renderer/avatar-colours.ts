// Sixteen colours with the widest OKLab spread (closest pair 0.093) that keeps dark initials readable: white
// falls under 3:1 above lightness ~0.64. `avatar-colours.test.ts` holds contrast and gamut for every stop.
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

export const INK = "oklch(0.22 0.01 285)";

export const GRADIENT = { lightness: 0.09, chroma: 0.92, hue: 12 } as const;

// Five and sixteen share no factor, so consecutive agents land far apart and every colour is reached.
const STEP = 5;

const entry = (colour: number) => PALETTE[(colour * STEP) % PALETTE.length]!;

export function avatarGradient(colour: number): string {
  const [l, c, h] = entry(colour);
  const top = `oklch(${(l + GRADIENT.lightness).toFixed(3)} ${c} ${h})`;
  const bottom = `oklch(${(l - GRADIENT.lightness).toFixed(3)} ${+(c * GRADIENT.chroma).toFixed(3)} ${h + GRADIENT.hue})`;
  // The gradient is Telegram's.
  return `linear-gradient(145deg, ${top}, ${bottom})`;
}

// Unclamped: a value outside 0..1 means the colour is outside the gamut.
export function linearSrgb([l, c, h]: readonly [number, number, number]): readonly [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const [x, y, z] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(
    (v) => v ** 3,
  ) as [number, number, number];
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

// DiceBear takes hex only.
export function avatarHex(colour: number): string {
  const encode = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };
  return `#${linearSrgb(entry(colour)).map((v) => Math.round(encode(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}
