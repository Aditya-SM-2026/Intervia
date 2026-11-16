const { BASE, browser, signedInContext } = require("./lib");
const id = process.argv[2]; const dir = __dirname;
(async () => { const b = await browser(); const ctx = await signedInContext(b); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${BASE}/dashboard/${id}`, { waitUntil: "networkidle" });
  // 1. Decision: pick Hold, add a note, save, reload, check it stuck, then clear.
  await page.getByRole("button", { name: /^Hold/ }).click();
  await page.getByPlaceholder("Why this decision? Notes for the hiring team").fill("AUDIT test decision note");
  await page.getByRole("button", { name: "Save decision" }).click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" });
  const pressed = await page.getByRole("button", { name: /^Hold/ }).getAttribute("aria-pressed");
  const note = await page.getByPlaceholder("Why this decision? Notes for the hiring team").inputValue();
  console.log("decision after reload:", pressed, JSON.stringify(note));
  await page.getByRole("button", { name: "Clear decision" }).click(); await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle" });
  console.log("after clear:", await page.getByRole("button", { name: /^Hold/ }).getAttribute("aria-pressed"));
  // 2. Re-score from the menu.
  const before = await (await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`)).json();
  const t0 = Date.now();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Re-score/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Re-scoring…"), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const after = await (await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`)).json();
  const sc = d => JSON.stringify(d.scorecard?.overall?.score ?? d.report?.overall?.score ?? null);
  console.log(`re-score: ${((Date.now()-t0)/1000).toFixed(0)}s, score before ${sc(before)} after ${sc(after)}, generatedAt changed: ${JSON.stringify(before.scorecard?.generatedAt) !== JSON.stringify(after.scorecard?.generatedAt)}`);
  await page.screenshot({ path: `${dir}/actions-rescored.png`, fullPage: false });
  // 3. Ask AI.
  await page.getByRole("button", { name: /Ask AI/ }).first().click();
  const box = page.locator("textarea").last();
  await box.fill("Did the candidate explain how they prevent duplicate charges? Quote them.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(25000);
  const panel = await page.locator("aside, [role=dialog]").last().innerText().catch(() => "");
  console.log("ask ai panel:", panel.replace(/\s+/g, " ").slice(0, 900));
  await page.screenshot({ path: `${dir}/actions-askai.png` });
  console.log("page errors:", errors);
  await b.close(); })();
