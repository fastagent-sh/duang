// The window's times: how long ago, the clock, and the list's coarse stamp.

// `numeric`, not `2-digit`: a 12-hour locale renders "01:08 AM".
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function ago(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}

export function stamp(ts: number, now: number = Date.now()): string {
  const at = new Date(ts);
  if (at.toDateString() === new Date(now).toDateString()) return clock(ts);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return midnight - ts < 6 * 86_400_000
    ? at.toLocaleDateString([], { weekday: "short" })
    : at.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
      });
}
