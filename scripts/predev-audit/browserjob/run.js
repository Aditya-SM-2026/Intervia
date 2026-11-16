// Cloud browser candidate: joins one interview through the real candidate page
// with Chrome's fake camera and a prepared microphone file, stays to the end.
const { chromium } = require("playwright");
const { BASE, ROOM, EMAIL } = process.env;
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-audio-capture=/app/browser-mic.wav%noloop", "--autoplay-policy=no-user-gesture-required"] });
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera", "microphone"] });
  const page = await c.newPage(); const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(0) + "s";
  page.on("pageerror", (e) => console.log(T(), "JSERR", String(e).slice(0, 200)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) console.log(T(), "HTTP", r.status(), r.url().replace(BASE, "")); });
  await page.goto(`${BASE}/interview/${ROOM}`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Your email address" }).fill(EMAIL);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Turn on camera and microphone" }).click(); await page.waitForTimeout(2000);
  await page.getByRole("checkbox", { name: /full screen/i }).check(); await page.getByRole("button", { name: "Join the interview" }).click();
  console.log(T(), "joined");
  let last = "";
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(10000);
    const status = await page.getByRole("status").first().innerText().catch(() => "");
    const body = (await page.locator("body").innerText()).replace(/\n+/g, " | ");
    if (status !== last) { console.log(T(), "status:", status); last = status; }
    if (/all done|interview has ended|You left/i.test(body) && !/\bLeave\b/.test(body)) { console.log(T(), "END SCREEN:", body.slice(0, 220)); break; }
  }
  // Give the recording upload time to finish before the browser closes.
  await page.waitForTimeout(20000);
  console.log(T(), "closing"); await b.close();
})().catch((e) => { console.log("FAILED", e.message); process.exit(1); });
