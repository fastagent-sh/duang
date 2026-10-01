/**
 * The drawn avatars, from DiceBear's styles (the drawings are CC0 except Bottts, which its artist,
 * Pablo Stanley, gives free for personal and commercial use; the code is MIT). Generated here, in the
 * page, as inline SVG: nothing is fetched, which the app's content security policy would refuse anyway.
 */
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

export type DrawnStyle = Exclude<AvatarStyle, "initials">;
const STYLES: Record<DrawnStyle, Style> = {
  gaze: new Style(gaze as never),
  moods: new Style(moods as never),
  clay: new Style(clay as never),
  bottts: new Style(bottts as never),
  pixelbot: new Style(pixelbot as never),
  initialFace: new Style(initialFace as never),
};

/**
 * Gaze's eyes are part of who an agent is, from these six, and the eyes its faces use (happy, small) are
 * kept out of them: an agent whose own eyes were the happy ones could not look happy about anything.
 */
export const IDENTITY_EYES = ["dots", "big", "shine", "beans", "wide", "tall"] as const;
const EXPRESSION: Partial<Record<Face, string>> = { done: "happy", failed: "small" };

/**
 * The part of each drawing that wears the agent's colour: its largest area, or for Pixelbot, whose
 * ground is always dark, its glowing face. Left to the style, the colour is a hash of the id into the
 * style's own few colours, and a handful of agents often share one (Clay has four browns in twelve).
 */
const COLOURED: Record<DrawnStyle, string> = {
  gaze: "bodyColor",
  moods: "faceColor",
  clay: "bodyColor",
  bottts: "backgroundColor",
  pixelbot: "glowColor",
  initialFace: "backgroundColor",
};

const drawn = new Map<string, string>();

/**
 * One avatar as an SVG string. The roster draws on every streamed token, so each one is made once and
 * kept. Its ids are made unique (`idRandomization`): the parts are `<defs>` drawn through `<use>`, and two
 * avatars sharing an id would both draw whichever came first in the page.
 */
export function avatarSvg(style: DrawnStyle, { id, name, colour, face }: { id: string; name: string; colour: number; face: Face }): string {
  const eyes = style === "gaze" ? (EXPRESSION[face] ?? "") : "";
  const key = `${style}\n${id}\n${name}\n${colour}\n${eyes}`;
  const cached = drawn.get(key);
  if (cached) return cached;
  const svg = new Drawn(STYLES[style], {
    // Initial face draws the name's first letter; every other style is seeded by the agent, so a rename
    // does not give it a new face.
    seed: style === "initialFace" ? name : id,
    idRandomization: true,
    // Every style but Gaze fills its square canvas; an avatar is a circle (the roster's contacts), so they
    // are cut to one. Gaze is a shape on nothing, and cutting it would only clip a corner.
    ...(style === "gaze" ? {} : { borderRadius: 50 }),
    // Gaze draws its shape in about two thirds of the canvas; at 1.2 it fills the avatar's circle as the other
    // styles do, and every shape still clears the canvas edge at its widest rotation (1.3 clips a corner).
    ...(style === "gaze" ? { scale: 1.2, eyesVariant: eyes ? [eyes] : [...IDENTITY_EYES] } : {}),
    [COLOURED[style]]: [avatarHex(colour)],
  }).toString();
  drawn.set(key, svg);
  return svg;
}
