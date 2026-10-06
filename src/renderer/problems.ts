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

interface Explained {
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

/** What a reason means, when its own markers say; undefined when nothing here recognises it. */
export const recognise = (reason: string): Explained | undefined => RULES.find(({ test }) => test.test(reason))?.explained;

/** A run that ended in a failure, explained from its reason. */
export function explainRunFailure(reason: string): Explained {
  return recognise(reason) ?? { title: "The run stopped with an error" };
}

/**
 * What the picker says when it opened because the conversation's model cannot run, read from the list it
 * shows: a provider with none of its models in it is not connected (and connecting it is offered); once the
 * model is in the list (its provider was just connected) there is nothing to say, and nothing while the list
 * is still loading, which would say the wrong thing first.
 */
export function unavailableNotice(model: string, models: readonly { spec: string }[] | undefined): { title: string; connect?: string } | undefined {
  if (!models || models.some(({ spec }) => spec === model)) return undefined;
  const provider = model.slice(0, model.indexOf("/"));
  return models.some(({ spec }) => spec.startsWith(`${provider}/`))
    ? { title: `${model.slice(provider.length + 1)} isn't available` }
    : { title: `${provider} isn't connected`, connect: provider };
}
