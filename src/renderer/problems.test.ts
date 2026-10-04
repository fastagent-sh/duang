import assert from "node:assert/strict";
import { test } from "node:test";
import { explainRunFailure, fileIn } from "./problems.ts";

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

test("a loading error's file is offered only inside the agent's folder, and only a kind people edit", () => {
  const dir = "/Users/me/research";
  assert.equal(fileIn(`${dir}/fastagent/fastagent.config.ts: Expected ',', got '}'`, dir), `${dir}/fastagent/fastagent.config.ts`);
  assert.equal(fileIn(`${dir}/fastagent/tools/fetch.ts:12:3: Unexpected token`, dir), `${dir}/fastagent/tools/fetch.ts`);
  assert.equal(fileIn("/etc/hosts.json: bad", dir), undefined, "outside the agent's folder");
  assert.equal(fileIn(`${dir}/fastagent/run.command: bad`, dir), undefined, "something the system would run");
  assert.equal(fileIn(`${dir}-other/fastagent.config.ts: bad`, dir), undefined, "a sibling folder with the same prefix");
  assert.equal(fileIn("missing model: set --model", dir), undefined);
});
