import type { SessionSummary } from "@fastagent-sh/fastagent/session";

export interface Row {
  session: string;
  label: string;
  updatedAt?: number;
  // Minted here; a session exists once a turn lands in it.
  fresh?: boolean;
  running?: boolean;
  draft?: boolean;
  unseen?: "done" | "failed";
}

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

// `numeric`, not `2-digit`: a 12-hour locale renders "01:08 AM".
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
    // A record with no message yet (its model or effort was set before the first send) is a new conversation.
    .map((s) =>
      mark({
        session: s.session,
        label: s.name ?? s.preview ?? (s.messageCount === 0 ? "New conversation" : s.session),
        updatedAt: s.updatedAt,
      }),
    );
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
