// Identity (drawing and colour, from id) never changes; the face follows what the agent does. The words
// beside it say the same: an avatar is never the only signal.
import { createContext, useContext, type CSSProperties } from "react";
import type { AvatarStyle } from "../preload/index.ts";
import { avatarGradient, INK } from "./avatar-colours.ts";
import { avatarSvg } from "./avatar-svg.ts";
import { WORKING, type Face } from "./face.ts";
import { initials } from "./initials.ts";

export const AvatarStyleContext = createContext<AvatarStyle>("gaze");

export function Avatar({
  id,
  name,
  colour,
  size = 40,
  face = "idle",
  style,
}: {
  id: string;
  name: string;
  colour: number;
  size?: number;
  face?: Face;
  style?: AvatarStyle;
}) {
  const chosen = useContext(AvatarStyleContext);
  const drawn = style ?? chosen;
  return (
    <span
      aria-hidden
      data-face={face}
      className={`avatar grid shrink-0 place-items-center rounded-full ${
        WORKING.includes(face) ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
      }`}
      // Each agent blinks on its own clock, so a roster never blinks in unison.
      style={{ width: size, height: size, "--delay": `${-((colour * 1.7) % 4.4).toFixed(2)}s` } as CSSProperties}
    >
      {drawn === "initials" ? (
        <span
          className="avatar-face grid size-full place-items-center rounded-full font-avatar font-semibold uppercase"
          style={{ backgroundImage: avatarGradient(colour), color: INK, fontSize: Math.round(size * 0.34) }}
        >
          {initials(name)}
        </span>
      ) : (
        <span className="avatar-face block size-full" dangerouslySetInnerHTML={{ __html: avatarSvg(drawn, { id, name, colour, face }) }} />
      )}
    </span>
  );
}
