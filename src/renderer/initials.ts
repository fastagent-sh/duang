export function initials(name: string): string {
  const marks = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  return (marks.length ? marks : [...name]).slice(0, 2).join("");
}
