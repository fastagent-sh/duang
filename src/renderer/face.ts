/**
 * What an agent's avatar shows: its identity (shape and colour) never changes, its face does. One face at
 * a time, by how much it asks of the person: a setup problem first (nothing else can happen until it is
 * fixed), then work in flight, then an outcome waiting to be looked at, then being the one on screen.
 * The words beside the avatar say all of this too; the face is the third signal, never the only one.
 */
import type { AgentState } from "./store.ts";

export type Face =
  | "idle"
  | "open"
  | "thinking"
  | "tool"
  | "answering"
  | "done"
  | "failed"
  | "asleep"
  | "unborn"
  | "broken";

/** The faces of an agent at work, which wear the presence ring. */
export const WORKING: readonly Face[] = ["thinking", "tool", "answering"];

export function faceOf({
  state,
  doing,
  outcomes,
  open,
}: {
  state: AgentState;
  /** The word the run status line shows for its running conversation (`phase`), when one runs. */
  doing?: string;
  /** Outcomes that landed while nobody was looking. */
  outcomes: readonly ("done" | "failed")[];
  /** It is the agent on screen. */
  open: boolean;
}): Face {
  if (state === "missing_model") return "asleep";
  if (state === "no_agent") return "unborn";
  if (state === "broken") return "broken";
  if (doing !== undefined)
    return doing === "answering" ? "answering" : ["thinking", "starting", "compacting"].includes(doing) ? "thinking" : "tool";
  if (outcomes.includes("failed")) return "failed";
  if (outcomes.length) return "done";
  return open ? "open" : "idle";
}
