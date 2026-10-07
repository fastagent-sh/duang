export const home = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, "~");

export const location = (dir: string): string => {
  const parts = home(dir).split("/").filter(Boolean);
  return parts.length > 1 ? `${parts.at(-1)} · ${parts.at(-2)}` : parts[0] ?? "/";
};
