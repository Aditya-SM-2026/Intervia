const { chromium } = require("playwright");
const BASE = "https://intervia-predev-web-199504026920.asia-south1.run.app";
const EXE = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
async function browser() { return chromium.launch({ executablePath: EXE }); }
async function signedInContext(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: "admin", password: process.env.AUDIT_PW }, headers: { "X-Forwarded-For": "192.0.2.77" } });
  if (r.status() !== 200) throw new Error("login failed " + r.status());
  return ctx;
}
module.exports = { BASE, browser, signedInContext };
