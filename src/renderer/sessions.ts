/** The conversation list the sidebar draws. Pure, because the one interesting case is invisible. */
import type { SessionSummary } from "@fastagent-sh/fastagent/session";

export interface Row {
  session: string;
  label: string;
  updatedAt?: number;
  /** Minted here and not yet known to the runtime: a session exists once a turn lands in it. */
  fresh?: boolean;
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
