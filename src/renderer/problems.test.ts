import assert from "node:assert/strict";
import { test } from "node:test";
import { explainRunFailure } from "./problems.ts";

test("a run's failure is explained from its own markers, and an unknown one gets the plain title, not a guess", () => {
  const title = (reason: string) => explainRunFailure(reason).title;
  // The reasons as pi and the providers write them (seen in the failure spikes and real sessions).
  assert.equal(title('OpenAI API error (401): {"message":"Incorrect API key"}'), "The provider did not accept the sign-in");
  assert.equal(explainRunFailure("No API key found for anthropic.").fix, "providers");
  assert.equal(
    title('OpenAI OAuth token request failed (403): {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported"}}'),
    "The provider does not serve this location",
    "a refused region is the route, not the sign-in",
  );
  assert.equal(title('OpenAI API error (529): {"message":"overloaded"}'), "The provider had a problem");
  assert.equal(title("server_error: upstream broke"), "The provider had a problem");
  assert.equal(title('Anthropic API error (429): rate_limit_error'), "The provider is limiting requests");
  assert.equal(title("Connection error."), "Could not reach the provider");
  assert.equal(explainRunFailure("fetch failed").fix, "network");
  assert.equal(title("socket hang up"), "Could not reach the provider");
  assert.deepEqual(explainRunFailure("the engine settled the run without ending an assistant message"), {
    title: "The run stopped with an error",
  });
  // A number that is not a status is not read as one.
  assert.equal(title("read 401 lines and then failed"), "The run stopped with an error");
});
