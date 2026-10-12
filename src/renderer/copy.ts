// The clipboard, in one place: four call sites copied to it, and two of them could not say that the copy was
// refused (an unfocused window, another process), so a refusal looked like a button that does nothing.
export type Copied = { ok: true } | { ok: false; error: string };

const why = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function copyToClipboard(
  text: string,
  write: (text: string) => Promise<void> = (value) => navigator.clipboard.writeText(value),
): Promise<Copied> {
  let started: Promise<void>;
  try {
    started = write(text);
  } catch (error) {
    // A clipboard that is missing, or throws where it is read, is the same answer to the person as one that
    // refuses: said on the control, never thrown out of the click.
    return Promise.resolve({ ok: false, error: why(error) });
  }
  return started.then(
    (): Copied => ({ ok: true }),
    (error: unknown): Copied => ({ ok: false, error: why(error) }),
  );
}
