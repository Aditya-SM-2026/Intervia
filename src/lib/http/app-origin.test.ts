// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAppOrigin } from "./app-origin.ts";

test("a configured base URL wins over anything the request says", () => {
  assert.equal(
    resolveAppOrigin({
      configured: "https://intervia-predev-web-5hszeawhaq-el.a.run.app/",
      host: "0.0.0.0:8080",
      fallback: "https://0.0.0.0:8080",
    }),
    "https://intervia-predev-web-5hszeawhaq-el.a.run.app",
  );
});

test("a configured base URL without a scheme gets https", () => {
  assert.equal(
    resolveAppOrigin({ configured: "apply.example.com" }),
    "https://apply.example.com",
  );
});

test("the container's own address never becomes a shared link", () => {
  assert.equal(
    resolveAppOrigin({ host: "0.0.0.0:8080", fallback: "https://localhost:3000" }),
    "https://localhost:3000",
  );
  assert.equal(resolveAppOrigin({ host: "0.0.0.0:8080" }), "");
});

test("a real host is used with the forwarded protocol", () => {
  assert.equal(
    resolveAppOrigin({
      host: "intervia-predev-web-5hszeawhaq-el.a.run.app",
      proto: "https",
      fallback: "https://0.0.0.0:8080",
    }),
    "https://intervia-predev-web-5hszeawhaq-el.a.run.app",
  );
  assert.equal(
    resolveAppOrigin({ host: "meetingbot.example.com" }),
    "https://meetingbot.example.com",
  );
});

test("forwarded hosts with a port or a list keep the first host", () => {
  assert.equal(
    resolveAppOrigin({ host: "app.example.com:8443, proxy.internal", proto: "http" }),
    "http://app.example.com:8443",
  );
});

test("local development stays on http localhost", () => {
  assert.equal(resolveAppOrigin({ host: "localhost:3000" }), "http://localhost:3000");
});

test("loopback addresses are treated as unusable for sharing", () => {
  assert.equal(resolveAppOrigin({ host: "127.0.0.1:3000" }), "");
  assert.equal(resolveAppOrigin({ host: "[::1]:3000" }), "");
});
