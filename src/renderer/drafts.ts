const KEY = "duang.drafts";
const UNREADABLE = "duang.drafts.unreadable";

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch (error) {
    console.error(`duang: ${key} was not saved:`, error);
  }
}

function read(): [string, string][] {
  let stored: string | null | undefined;
  try {
    stored = globalThis.localStorage?.getItem(KEY);
  } catch {
    return [];
  }
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    const pair = (entry: unknown) =>
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string";
    if (Array.isArray(parsed) && parsed.every(pair)) return parsed as [string, string][];
    throw new Error("expected a list of [conversation, text] pairs");
  } catch (error) {
    write(UNREADABLE, stored);
    console.error(`duang: unreadable drafts moved to ${UNREADABLE}:`, error);
    return [];
  }
}

export function createDraftStorage() {
  const entries = read();
  let saved = "";
  return {
    entries,
    save(entries: [string, string][]) {
      const value = JSON.stringify(entries);
      if (value === saved) return;
      saved = value;
      write(KEY, value);
    },
  };
}
