/** The conversation list the sidebar draws. Pure, because the one interesting case is invisible. */
import type { SessionSummary } from "@fastagent-sh/fastagent/session";

export interface Row {
  session: string;
  label: string;
  updatedAt?: number;
  /** Minted here and not yet known to the runtime: a session exists once a turn lands in it. */
  fresh?: boolean;
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

export function rows(summaries: SessionSummary[], selected?: string): Row[] {
  const known = [...summaries]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({ session: s.session, label: s.name ?? s.preview ?? s.session, updatedAt: s.updatedAt }));
  if (selected && !known.some((row) => row.session === selected)) {
    return [{ session: selected, label: "New conversation", fresh: true }, ...known];
  }
  return known;
}
