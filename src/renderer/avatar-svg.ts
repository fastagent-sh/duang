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

type DrawnStyle = Exclude<AvatarStyle, "initials">;
/** Every style but Gaze fills its square canvas; an avatar is a circle (the roster's contacts), so they are cut to one. */
const CIRCLE = { borderRadius: 50 };
/**
 * Each style, and what it needs to be an agent's: its DiceBear definition; the part that wears the agent's
 * colour (its largest, or for Pixelbot, whose ground is always dark, its glowing face), because left to
 * the style the colour is a hash of the id into its own few and a handful of agents often share one (Clay
 * has four browns in twelve); and its other options. Each is seeded by the agent's id, so a rename keeps
 * the drawing, except Initial face, which draws the name's first letter.
 */
const STYLES: Record<DrawnStyle, { definition: Style; coloured: string; options: object; seed?: "name" }> = {
  // A shape on nothing: cutting it would only clip a corner. It draws in about two thirds of the canvas, and
  // at 1.2 fills the avatar's circle as the others do; every shape still clears the edge at its widest
  // rotation (1.3 clips a corner).
  gaze: { definition: new Style(gaze as never), coloured: "bodyColor", options: { scale: 1.2 } },
  moods: { definition: new Style(moods as never), coloured: "faceColor", options: CIRCLE },
  clay: { definition: new Style(clay as never), coloured: "bodyColor", options: CIRCLE },
  bottts: { definition: new Style(bottts as never), coloured: "backgroundColor", options: CIRCLE },
  pixelbot: { definition: new Style(pixelbot as never), coloured: "glowColor", options: CIRCLE },
  initialFace: { definition: new Style(initialFace as never), coloured: "backgroundColor", options: CIRCLE, seed: "name" },
};

/**
 * Gaze's eyes are part of who an agent is, from these six, and the eyes its faces use (happy, small) are
 * kept out of them: an agent whose own eyes were the happy ones could not look happy about anything.
 */
const IDENTITY_EYES = ["dots", "big", "shine", "beans", "wide", "tall"] as const;
const EXPRESSION: Partial<Record<Face, string>> = { done: "happy", failed: "small" };

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
  const { definition, coloured, options, seed } = STYLES[style];
  const svg = new Drawn(definition, {
    seed: seed === "name" ? name : id,
    idRandomization: true,
    ...options,
    [coloured]: [avatarHex(colour)],
    // Only Gaze's eyes move: its own pair at rest, an expressive one for an outcome.
    ...(style === "gaze" && { eyesVariant: eyes ? [eyes] : [...IDENTITY_EYES] }),
  }).toString();
  drawn.set(key, svg);
  return svg;
}
