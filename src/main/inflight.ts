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
