import assert from "node:assert/strict";
import { test } from "node:test";
import { manualUrl } from "./network.ts";

test("server and port become a proxy URL, and each field says what is wrong with it", () => {
  assert.deepEqual(manualUrl("socks5", " 127.0.0.1 ", "7891"), { url: "socks5://127.0.0.1:7891" });
  assert.deepEqual(manualUrl("http", "proxy.corp", "080"), { url: "http://proxy.corp:80" });
  assert.deepEqual(manualUrl("http", "", "7890"), { error: "Server is required" });
  assert.match((manualUrl("http", "http://127.0.0.1", "7890") as { error: string }).error, /without a scheme or path/);
  assert.match((manualUrl("http", "127.0.0.1/x", "7890") as { error: string }).error, /without a scheme or path/);
  for (const port of ["", "0", "65536", "78a", "-1"])
    assert.deepEqual(manualUrl("http", "127.0.0.1", port), { error: "Port is a number from 1 to 65535" }, port);
});
