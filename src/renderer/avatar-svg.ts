// DiceBear styles (CC0, except Bottts: free use by Pablo Stanley). Generated inline: the CSP refuses fetches.
import { Avatar as Drawn, Style } from "@dicebear/core";
import gaze from "@dicebear/styles/gaze.json" with { type: "json" };
import moods from "@dicebear/styles/moods.json" with { type: "json" };
import clay from "@dicebear/styles/clay.json" with { type: "json" };
import bottts from "@dicebear/styles/bottts-neutral.json" with { type: "json" };
import pixelbot from "@dicebear/styles/pixelbot.json" with { type: "json" };
import initialFace from "@dicebear/styles/initial-face.json" with { type: "json" };
import type { AvatarStyle } from "../preload/index.ts";
import { avatarHex } from "./avatar-colours.ts";
import type { Face } from "./face.ts";

type DrawnStyle = Exclude<AvatarStyle, "initials">;
const CIRCLE = { borderRadius: 50 };
// The `coloured` part wears the agent's colour; left to the style it hashes into a few colours and agents
// share them (Clay has four browns in twelve). Seeded by id, so a rename keeps the drawing.
const STYLES: Record<DrawnStyle, { definition: Style; coloured: string; options: object; seed?: "name" }> = {
  // 1.2 fills the circle; 1.3 clips a corner at its widest rotation.
  gaze: { definition: new Style(gaze as never), coloured: "bodyColor", options: { scale: 1.2 } },
  moods: { definition: new Style(moods as never), coloured: "faceColor", options: CIRCLE },
  clay: { definition: new Style(clay as never), coloured: "bodyColor", options: CIRCLE },
  bottts: { definition: new Style(bottts as never), coloured: "backgroundColor", options: CIRCLE },
  pixelbot: { definition: new Style(pixelbot as never), coloured: "glowColor", options: CIRCLE },
  initialFace: { definition: new Style(initialFace as never), coloured: "backgroundColor", options: CIRCLE, seed: "name" },
};

// The eyes faces use (happy, small) are kept out, or an agent with those eyes could not look happy.
const IDENTITY_EYES = ["dots", "big", "shine", "beans", "wide", "tall"] as const;
const EXPRESSION: Partial<Record<Face, string>> = { done: "happy", failed: "small" };

const drawn = new Map<string, string>();

// Cached: the roster draws on every streamed token. `idRandomization`: two avatars sharing a `<defs>` id
// would both draw whichever came first.
export function avatarSvg(style: DrawnStyle, { id, name, colour, face }: { id: string; name: string; colour: number; face: Face }): string {
  const eyes = style === "gaze" ? (EXPRESSION[face] ?? "") : "";
  const key = `${style}\n${id}\n${name}\n${colour}\n${eyes}`;
  const cached = drawn.get(key);
  if (cached) return cached;
  const { definition, coloured, options, seed } = STYLES[style];
  const svg = new Drawn(definition, {
    seed: seed === "name" ? name : id,
    idRandomization: true,
    ...options,
    [coloured]: [avatarHex(colour)],
    ...(style === "gaze" && { eyesVariant: eyes ? [eyes] : [...IDENTITY_EYES] }),
  }).toString();
  drawn.set(key, svg);
  return svg;
}
