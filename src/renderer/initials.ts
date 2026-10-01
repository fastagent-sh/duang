/**
 * The two characters an avatar shows for a name: its first two letters or digits, any script, skipping
 * punctuation. A folder name is often `a-very-long-name` or `.dotfiles`, and "A-" says nothing.
 */
export function initials(name: string): string {
  const marks = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  return (marks.length ? marks : [...name]).slice(0, 2).join("");
}
