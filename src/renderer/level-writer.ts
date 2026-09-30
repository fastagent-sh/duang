/**
 * Writes the thinking level a person chose, once per choice. Every write is a durable entry in the
 * conversation's record, so the arrow keys, which fire a change at each stop they cross, wait for a
 * rest; a click is one choice and goes at once.
 *
 * A choice carries the conversation it was made for. It is written to that one however long it waits
 * and whatever is open by then, and a choice for another conversation writes the waiting one first
 * instead of replacing it.
 */
export function createLevelWriter<T>(options: {
  /** How long the keys must rest before their last stop is written. */
  pauseMs: number;
  /** Whether the runtime took the level. */
  write: (target: T, level: string) => Promise<boolean>;
  /** The runtime did not take a level that was written. */
  refused: (target: T) => void;
}) {
  let waiting: { target: T; level: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Writes the waiting choice now: at a rest, or when the picker closes. */
  function flush() {
    clearTimeout(timer);
    const choice = waiting;
    waiting = undefined;
    if (!choice) return;
    void options.write(choice.target, choice.level).then((taken) => {
      if (!taken) options.refused(choice.target);
    });
  }

  return {
    choose(target: T, level: string, byKey: boolean) {
      if (waiting && waiting.target !== target) flush();
      waiting = { target, level };
      clearTimeout(timer);
      if (byKey) timer = setTimeout(flush, options.pauseMs);
      else flush();
    },
    flush,
  };
}
