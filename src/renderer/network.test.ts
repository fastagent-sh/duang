import assert from "node:assert/strict";
import { test } from "node:test";
import { manualFields, manualUrl } from "./network.ts";

test("server and port become a proxy URL, and each field says what is wrong with it", () => {
  assert.deepEqual(manualUrl("socks5", " 127.0.0.1 ", "7891"), { url: "socks5://127.0.0.1:7891" });
  assert.deepEqual(manualUrl("http", "proxy.corp", "080"), { url: "http://proxy.corp:80" });
  assert.deepEqual(manualUrl("http", "", "7890"), { error: "Server is required" });
  assert.match((manualUrl("http", "http://127.0.0.1", "7890") as { error: string }).error, /without a scheme or path/);
  assert.match((manualUrl("http", "127.0.0.1/x", "7890") as { error: string }).error, /without a scheme or path/);
  for (const port of ["", "0", "65536", "78a", "-1"])
    assert.deepEqual(manualUrl("http", "127.0.0.1", port), { error: "Port is a number from 1 to 65535" }, port);
});

test("a saved proxy reads back into the form with its port, default ports included", () => {
  assert.deepEqual(manualFields("http://proxy.corp:80"), { scheme: "http", server: "proxy.corp", port: "80" });
  assert.deepEqual(manualFields("https://proxy.corp:443"), { scheme: "https", server: "proxy.corp", port: "443" });
  assert.deepEqual(manualFields("socks5://[::1]:1080"), { scheme: "socks5", server: "[::1]", port: "1080" });
  assert.throws(() => manualFields("http://proxy.corp"), /not scheme:\/\/host:port/);
  // What the form saves reads back unchanged.
  const saved = manualUrl("https", "proxy.corp", "443");
  assert.deepEqual("url" in saved && manualFields(saved.url), { scheme: "https", server: "proxy.corp", port: "443" });
});
