import type { DuangApi, ProviderUsage } from "../preload/index.ts";
import { message } from "./message.ts";

export type PlanUsageView = Record<string, { data?: ProviderUsage; error?: string }>;

export function createProviderUsage(
  api: DuangApi,
  snapshot: () => { usage: PlanUsageView },
  publish: (patch: { usage: PlanUsageView }) => void,
) {
  return {
    forget(provider: string) {
      const { [provider]: _gone, ...usage } = snapshot().usage;
      publish({ usage });
    },
    // Main answers from its cache inside the gap. A failure replaces the numbers: a stale percentage is quietly wrong.
    async loadUsage(provider: string) {
      try {
        const data = await api.providerUsage(provider);
        publish({ usage: { ...snapshot().usage, [provider]: { data } } });
      } catch (error) {
        publish({ usage: { ...snapshot().usage, [provider]: { error: message(error) } } });
      }
    },
  };
}
