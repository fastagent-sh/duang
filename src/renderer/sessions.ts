/** The conversation list the sidebar draws. Pure, because the one interesting case is invisible. */
import type { SessionSummary } from "@fastagent-sh/fastagent/session";

export interface Row {
  session: string;
  label: string;
  updatedAt?: number;
  /** Minted here and not yet known to the runtime: a session exists once a turn lands in it. */
  fresh?: boolean;
  /** A turn is in flight in this conversation. The sidebar's answer to "which one is working". */
  running?: boolean;
  /** Unsent text is waiting here. Listed for the same reason a running one is: it is not finished. */
  draft?: boolean;
  /** An outcome that landed while the person was elsewhere, and has not been looked at yet. */
  unseen?: "done" | "failed";
}

/** A timestamp as a list row wants it: coarse on purpose, because an exact clock time is noise here. */
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

/** Clock time. `numeric` hours, not `2-digit`: a 12-hour locale renders "01:08 AM" for the second one. */
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A list row's time, the way Telegram's list gives it: the clock today, the weekday this week, a date before. */
export function stamp(ts: number, now: number = Date.now()): string {
  const at = new Date(ts);
  if (at.toDateString() === new Date(now).toDateString()) return clock(ts);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return midnight - ts < 6 * 86_400_000
    ? at.toLocaleDateString([], { weekday: "short" })
    : at.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
}

export function rows(
  summaries: SessionSummary[],
  selected?: string,
  running: string[] = [],
  drafts: string[] = [],
  unseen: Record<string, "done" | "failed"> = {},
): Row[] {
  const mark = <T extends { session: string }>(row: T) => ({
    ...row,
    ...(running.includes(row.session) ? { running: true } : {}),
    ...(drafts.includes(row.session) ? { draft: true } : {}),
    ...(unseen[row.session] ? { unseen: unseen[row.session] } : {}),
  });
  const known = [...summaries]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => mark({ session: s.session, label: s.name ?? s.preview ?? s.session, updatedAt: s.updatedAt }));
  const local = [...new Set([...(selected ? [selected] : []), ...running, ...drafts])]
    .filter((session) => !known.some((row) => row.session === session))
    .map((session) =>
      mark({
        session,
        label: running.includes(session) ? "Running conversation" : "New conversation",
        fresh: true,
      }),
    );
  return [...local, ...known];
}
