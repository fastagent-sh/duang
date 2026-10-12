// The clipboard, in one place: four call sites copied to it, and two of them could not say that the copy was
// refused (an unfocused window, another process), so a refusal looked like a button that does nothing.
export type Copied = { ok: true } | { ok: false; error: string };

export function copyToClipboard(
  text: string,
  write: (text: string) => Promise<void> = (value) => navigator.clipboard.writeText(value),
): Promise<Copied> {
  return write(text).then(
    (): Copied => ({ ok: true }),
    (error: unknown): Copied => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
}
