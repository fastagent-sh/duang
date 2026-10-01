/**
 * One run per key at a time: a call made while one is running for the same key joins it and gets its
 * answer, instead of starting a second. For work that goes to the network and writes a file, where the
 * second run would only repeat the first.
 */
export function inflight<V>(run: (key: string) => Promise<V>): (key: string) => Promise<V> {
  const running = new Map<string, Promise<V>>();
  return (key) => {
    const joined = running.get(key);
    if (joined) return joined;
    const started = run(key).finally(() => running.delete(key));
    running.set(key, started);
    return started;
  };
}
