import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GLOBAL_AUTH_PATH } from "@fastagent-sh/fastagent/pi";

/** `authPath` is resolved once at import, so each case needs its own module instance. */
async function authPathWith(override: string | undefined, label: string): Promise<string> {
  const previous = process.env.FASTAGENT_AUTH_PATH;
  if (override === undefined) delete process.env.FASTAGENT_AUTH_PATH;
  else process.env.FASTAGENT_AUTH_PATH = override;
  try {
    const module = (await import(`./credentials.ts?case=${label}`)) as { authPath: string };
    return module.authPath;
  } finally {
    if (previous === undefined) delete process.env.FASTAGENT_AUTH_PATH;
    else process.env.FASTAGENT_AUTH_PATH = previous;
  }
}

test("the credential file is FastAgent's own by default, and the override expands ~", async () => {
  // Anything else means duang reads a file `fastagent login` never writes.
  assert.equal(await authPathWith(undefined, "default"), GLOBAL_AUTH_PATH);
  assert.equal(await authPathWith("~/creds/auth.json", "tilde"), join(homedir(), "creds", "auth.json"));
  assert.equal(await authPathWith("/tmp/creds/auth.json", "absolute"), "/tmp/creds/auth.json");
});
