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
