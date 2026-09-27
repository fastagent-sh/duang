/** Paths as a person reads them. */
/** A path as a person writes it. */
export const home = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, "~");

/** Lead with the directory name so truncation keeps it visible; the full path is in the title. */
export const location = (dir: string): string => {
  const parts = home(dir).split("/").filter(Boolean);
  return parts.length > 1 ? `${parts.at(-1)} · ${parts.at(-2)}` : parts[0] ?? "/";
};
