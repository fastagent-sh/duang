/**
 * What a failure means for the person, in their words, from the reason the provider or runtime gave.
 *
 * The reason itself is always shown verbatim beside this (AGENTS.md: original errors are kept); this only
 * puts a plain title and the likely way on in front of it. It reads the reason's own markers (an HTTP
 * status in pi's `… API error (401)`, a network error code), so a reason it does not recognise gets the
 * plain title and no guess.
 */

/**
 * Where in duang the way on is, when it is somewhere other than trying again: signing in to the provider
 * again, the network settings, or another model for this conversation.
 */
export type Fix = "providers" | "network" | "model";

export interface Explained {
  title: string;
  /** One sentence on what to do, when there is something besides reading the reason. */
  advice?: string;
  fix?: Fix;
}

const RULES: { test: RegExp; explained: Explained }[] = [
  {
    // Checked before the generic 403: the provider refuses where the request comes from, not who sent it.
    test: /unsupported_country|country, region,? or territory|region.*not supported/i,
    explained: {
      title: "The provider does not serve this location",
      advice: "Requests reach it from a region it refuses. A different network route may work.",
      fix: "network",
    },
  },
  {
    test: /\((?:401|403)\)|\b(?:401|403) (?:unauthori[sz]ed|forbidden)|invalid[_ ]api[_ ]key|incorrect api key|authentication|no api key/i,
    explained: {
      title: "The provider did not accept the sign-in",
      advice: "The key or sign-in may have expired or been revoked. Sign in again, then retry.",
      fix: "providers",
    },
  },
  {
    test: /\(429\)|rate.?limit|too many requests|insufficient_quota|quota exceeded|usage limit/i,
    explained: { title: "The provider is limiting requests", advice: "Wait a little and retry, or use another model.", fix: "model" },
  },
  {
    test: /\((?:500|502|503|504|529)\)|overloaded|server_error|internal server error|bad gateway|service unavailable/i,
    explained: {
      title: "The provider had a problem",
      advice: "This is usually brief. Retry in a moment, or use another model.",
      fix: "model",
    },
  },
  {
    test: /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR|fetch failed|connection error|socket hang up|network error|unsupported proxy route/i,
    explained: {
      title: "Could not reach the provider",
      advice: "Check the connection or the proxy in Network settings, then retry.",
      fix: "network",
    },
  },
];

/** A run that ended in a failure, explained from its reason. */
export function explainRunFailure(reason: string): Explained {
  return RULES.find(({ test }) => test.test(reason))?.explained ?? { title: "The run stopped with an error" };
}

/**
 * The agent's config, when a loading error names it first (`…/fastagent.config.ts: Expected ','`): the
 * one file duang offers to start afresh. Only inside `dir`; main checks again before touching it.
 */
export function configIn(reason: string, dir: string): string | undefined {
  const file = reason.match(/^(\/[^\n]*?\/fastagent\.config\.ts)(?::\d+(?::\d+)?)?[:\s]/m)?.[1];
  return file?.startsWith(`${dir}/`) ? file : undefined;
}
