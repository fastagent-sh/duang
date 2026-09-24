/** How the header says how much is left: plan windows and the context window. Pure, so it is testable. */
import type { UsageWindow } from "../preload/index.ts";

const DAY_MS = 24 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "14:29" inside a day's window, "Fri 03:59" for a longer one: the reset is always within one week. */
export function resetLabel(window: UsageWindow): string | undefined {
  if (window.resetsAt === undefined) return undefined;
  const d = new Date(window.resetsAt);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return window.windowSeconds * 1000 < DAY_MS ? time : `${DAYS[d.getDay()]} ${time}`;
}

/**
 * Used minus the share of the window already elapsed: negative is under pace (▼), positive is
 * burning faster than the clock (▲). Only for windows of a day or more — five hours is too short
 * for "pace" to mean anything a person would act on.
 */
export function pace(window: UsageWindow, now: number): number | undefined {
  const length = window.windowSeconds * 1000;
  if (window.resetsAt === undefined || length < DAY_MS) return undefined;
  const elapsed = Math.min(1, Math.max(0, (now - (window.resetsAt - length)) / length));
  return window.percent - elapsed * 100;
}

export const paceLabel = (diff: number) => `${diff > 0 ? "▲" : "▼"}${Math.abs(diff).toFixed(1)}%`;

/**
 * The provider's own sentence, without the call stack some errors carry inside their message (pi-ai's
 * `ModelsError` appends `stack=` and every frame). The first line keeps what failed and why.
 */
export const errorLine = (error: string) => error.split("\n", 1)[0]!.trim();

/** "1.0M", "200K": a context window's size, the way model pages print it. */
export function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}

/** "45.1%/1.0M": how full, out of how much. */
export const contextLabel = (used: number, window: number) =>
  `${((used / window) * 100).toFixed(1)}%/${tokens(window)}`;
