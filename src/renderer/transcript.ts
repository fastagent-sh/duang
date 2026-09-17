/** Fold session entries and live events into what the transcript shows. Pure, so it is testable. */
import type { SessionEntry, SessionEvent } from "@fastagent-sh/fastagent/session";

export type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant" | "thinking"; text: string; open: boolean }
  | { kind: "tool"; id: string; name: string; args: unknown; result?: unknown; isError?: boolean }
  | { kind: "note"; text: string };

/** Best-effort text out of an engine-specific entry payload. */
function entryText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.content)) {
      return record.content
        .map((part) => (part && typeof part === "object" ? String((part as { text?: string }).text ?? "") : ""))
        .join("");
    }
  }
  return "";
}

/** History: only the three kinds the contract guarantees; anything engine-specific is skipped. */
export function fromEntries(entries: SessionEntry[]): Item[] {
  const items: Item[] = [];
  for (const entry of entries) {
    if (entry.kind === "user") items.push({ kind: "user", text: entryText(entry.data) });
    else if (entry.kind === "assistant") items.push({ kind: "assistant", text: entryText(entry.data), open: false });
    else if (entry.kind === "tool") {
      const data = (entry.data ?? {}) as { id?: string; name?: string; args?: unknown; content?: unknown };
      items.push({ kind: "tool", id: String(data.id ?? entry.id), name: String(data.name ?? "tool"), args: data.args, result: data.content });
    }
  }
  return items;
}

/** One live event applied to the list. Returns a new list; unknown event types change nothing. */
export function apply(items: Item[], event: SessionEvent): Item[] {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case "message_delta": {
      const kind = data.channel === "thinking" ? "thinking" : "assistant";
      const last = items.at(-1);
      if (last && last.kind === kind && last.open) {
        return [...items.slice(0, -1), { ...last, text: last.text + String(data.delta ?? "") }];
      }
      return [...items, { kind, text: String(data.delta ?? ""), open: true }];
    }
    case "message_finished": {
      const last = items.at(-1);
      if (last && (last.kind === "assistant" || last.kind === "thinking") && last.open) {
        return [...items.slice(0, -1), { ...last, open: false }];
      }
      return items;
    }
    case "tool_started":
      return [...items, { kind: "tool", id: String(data.id), name: String(data.name), args: data.args }];
    case "tool_progress":
    case "tool_finished": {
      const id = String(data.id);
      const index = items.findLastIndex((item) => item.kind === "tool" && item.id === id);
      if (index < 0) return items;
      const tool = items[index] as Extract<Item, { kind: "tool" }>;
      const updated: Item =
        event.type === "tool_finished"
          ? { ...tool, result: data.content, isError: Boolean(data.isError) }
          : { ...tool, result: data.partialResult };
      return [...items.slice(0, index), updated, ...items.slice(index + 1)];
    }
    case "run_settled": {
      // A completed run says nothing the transcript does not already show; a failed or aborted one does.
      if (data.status === "completed") return items;
      const error = data.error as { message?: string } | undefined;
      return [...items, { kind: "note", text: `run ${String(data.status)}${error?.message ? `: ${error.message}` : ""}` }];
    }
    case "retry_scheduled":
      return [...items, { kind: "note", text: `retrying: ${String(data.reason ?? "")}` }];
    // Not from the engine: the main process reports what the stream itself could not.
    case "send_failed":
    case "stream_failed":
      return [...items, { kind: "note", text: String(data.reason ?? event.type) }];
    default:
      return items;
  }
}

export function echoUser(items: Item[], text: string): Item[] {
  return [...items, { kind: "user", text }];
}
