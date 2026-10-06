/** How the header says how much is left: plan windows and the context window. Pure, so it is testable. */
import type { UsageWindow } from "../preload/index.ts";
import { clock } from "./sessions.ts";

const DAY_MS = 24 * 3600 * 1000;

/**
 * The clock time inside a day's window, with the weekday for a longer one (the reset is always within one week),
 * written as the transcript writes its times.
 */
export function resetLabel(window: UsageWindow): string | undefined {
  if (window.resetsAt === undefined) return undefined;
  const time = clock(window.resetsAt);
  if (window.windowSeconds * 1000 < DAY_MS) return time;
  return `${new Date(window.resetsAt).toLocaleDateString([], { weekday: "short" })} ${time}`;
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

/** "1.0M", "200K": a context window's size, the way model pages print it. */
export function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}
