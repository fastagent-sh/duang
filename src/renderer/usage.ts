import type { UsageWindow } from "../preload/index.ts";
import { clock } from "./sessions.ts";

const DAY_MS = 24 * 3600 * 1000;

export function resetLabel(window: UsageWindow): string | undefined {
  if (window.resetsAt === undefined) return undefined;
  const time = clock(window.resetsAt);
  if (window.windowSeconds * 1000 < DAY_MS) return time;
  return `${new Date(window.resetsAt).toLocaleDateString([], { weekday: "short" })} ${time}`;
}

// Only for windows of a day or more: five hours is too short for pace to mean anything.
export function pace(window: UsageWindow, now: number): number | undefined {
  const length = window.windowSeconds * 1000;
  if (window.resetsAt === undefined || length < DAY_MS) return undefined;
  const elapsed = Math.min(1, Math.max(0, (now - (window.resetsAt - length)) / length));
  return window.percent - elapsed * 100;
}

export const paceLabel = (diff: number) => `${diff > 0 ? "▲" : "▼"}${Math.abs(diff).toFixed(1)}%`;

export function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}
