/**
 * An agent's avatar: a circle's worth of face, because an agent is a contact and the roster reads as one
 * (§12). Three layers, kept apart (docs/ui.md §3):
 * - identity, the drawing and its colour, from the agent's id and the registry's colour number: the same
 *   agent looks the same everywhere, in every state, and a rename does not change it;
 * - face, the eyes and how the avatar moves, which follow what the agent is doing (`face.ts`, index.css);
 * - presence, a still ring while it works.
 * The words beside it say all of this as well; an avatar is never the only signal.
 */
import { createContext, useContext, type CSSProperties } from "react";
import type { AvatarStyle } from "../preload/index.ts";
import { avatarGradient, INK } from "./avatar-colours.ts";
import { avatarSvg } from "./avatar-svg.ts";
import { WORKING, type Face } from "./face.ts";
import { initials } from "./initials.ts";

/** How avatars are drawn, from Settings; provided once, so a change redraws every avatar at once. */
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
  /** Drawn in this style whatever Settings says: the Settings page's own previews. */
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
