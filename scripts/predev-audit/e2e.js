// End-to-end check of every non-voice feature on predev. Dummy data only
// (AUDIT names, example.com emails); everything created is recorded in
// e2e-state.json for cleanup.
const fs = require("fs");
const { chromium } = require("playwright");
const { BASE, browser, signedInContext } = require("./lib");
const A = `${__dirname}/fixtures`;
const RESUME = fs.readFileSync(`${A}/resume.pdf`), FAKE = fs.readFileSync(`${A}/fake.pdf`);
const results = []; const state = { roles: [], interviews: [], members: [] };
let area = "";
const section = (name) => { area = name; console.log(`\n## ${name}`); };
const check = (cond, label, extra = "") => {
  results.push({ area, label, pass: !!cond, extra: cond ? "" : String(extra).slice(0, 300) });
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !extra ? "" : "  :: " + String(extra).slice(0, 300)}`);
};
const safe = async (label, fn) => { try { await fn(); } catch (e) { check(false, label + " (crashed)", e.message.split("\n")[0]); } };
const save = () => fs.writeFileSync(`${__dirname}/e2e-state.json`, JSON.stringify(state, null, 1));
const tag = Date.now().toString(36).slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await browser();
  const admin = await signedInContext(b); const api = admin.request;
  const anon = await b.newContext(); const pub = anon.request;
  const login = async (username, password, ip = "192.0.2.78") => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username, password }, headers: { "X-Forwarded-For": ip } });
    return { ctx, status: r.status() };
  };

  section("Security and access");
  await safe("security", async () => {
    const h = (await pub.get(BASE + "/login")).headers();
    check(h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff" && h["strict-transport-security"] && !h["x-powered-by"], "security headers on every page");
    for (const path of ["/api/dashboard/interviews", "/api/roles", "/api/team", "/api/activity", "/api/dashboard/stats", "/api/settings/agent"]) {
      const s = (await pub.get(BASE + path)).status();
      check(s === 401, `signed out: ${path} refused`, s);
    }
    const page = await anon.newPage(); await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    check(page.url().includes("/login"), "signed out: dashboard sends you to the login page", page.url());
    await page.close();
    check((await login("admin", "wrong-password-xyz", "192.0.2.79")).status === 401, "wrong password refused");
    for (const path of ["/api/cron/sweep", "/api/internal/jobs", "/api/internal/video-result", "/api/internal/mix-result"]) {
      const s = (await pub.post(BASE + path, { data: {} })).status();
      check(s === 401 || s === 403, `internal endpoint ${path} needs its secret`, s);
    }
    const s = (await pub.get(`${BASE}/api/agent/interviews/AAAAAAAAAAAAAAAAAAAAAA`)).status();
    check(s === 401 || s === 403, "agent API needs its secret", s);
  });

  section("Team accounts");
  const memberEmail = `audit.member.${tag}@example.com`, pw1 = "AuditStart!2026a", pw2 = "AuditChanged!2026b", pw3 = "AuditReset!2026c";
  let member = null, memberCtx = null;
  await safe("team", async () => {
    const r = await api.post(`${BASE}/api/team`, { data: { name: `AUDIT Member ${tag}`, email: memberEmail, password: pw1 } });
    const body = await r.json(); member = body.member; if (member) { state.members.push(member.id); save(); }
    check(r.status() === 200 || r.status() === 201, "admin adds a team member", JSON.stringify(body));
    const dup = await api.post(`${BASE}/api/team`, { data: { name: "AUDIT Dup", email: memberEmail, password: pw1 } });
    check(dup.status() === 409, "same email twice is refused", dup.status());
    const short = await api.post(`${BASE}/api/team`, { data: { name: "AUDIT Short", email: `audit.short.${tag}@example.com`, password: "abc" } });
    check(short.status() === 400, "too-short starting password refused", short.status());
    const m = await login(memberEmail, pw1); memberCtx = m.ctx;
    check(m.status === 200, "member signs in with their email", m.status);
    const me = await (await memberCtx.request.get(`${BASE}/api/auth/me`)).json();
    check(me.actor?.role === "member" || me.role === "member" || JSON.stringify(me).includes("member"), "member is signed in as a member, not admin", JSON.stringify(me));
    check((await memberCtx.request.get(`${BASE}/api/team`)).status() === 403, "member cannot open Team");
    check((await memberCtx.request.get(`${BASE}/api/activity`)).status() === 403, "member cannot open Activity");
    check((await memberCtx.request.get(`${BASE}/api/dashboard/interviews`)).status() === 200, "member can use the dashboard");
    const wrong = await memberCtx.request.post(`${BASE}/api/account/password`, { data: { current: "nope-nope-nope", next: pw2 } });
    check(wrong.status() === 400, "password change with the wrong current password refused", wrong.status());
    const changed = await memberCtx.request.post(`${BASE}/api/account/password`, { data: { current: pw1, next: pw2 } });
    check(changed.status() === 200, "member changes their own password", changed.status());
    check((await login(memberEmail, pw1)).status === 401, "old password no longer works");
    const m2 = await login(memberEmail, pw2); memberCtx = m2.ctx;
    check(m2.status === 200, "new password works");
    // A member's action is credited to them.
    const role = (await (await memberCtx.request.post(`${BASE}/api/roles`, { data: { title: `AUDIT Member Role ${tag}`, description: "About the role\nSafe to delete.", skills: ["SQL"] } })).json()).role;
    if (role) { state.roles.push(role.id); save(); }
    await sleep(1500);
    const act = await (await api.get(`${BASE}/api/activity?limit=20`)).json();
    const entry = (act.entries || []).find((e) => e.action === "role.created" && e.targetId === role?.id);
    check(entry && entry.actorName === `AUDIT Member ${tag}`, "activity log credits the member who did it", JSON.stringify(entry));
    const reset = await api.patch(`${BASE}/api/team/${member.id}`, { data: { password: pw3 } });
    check(reset.status() === 200, "admin resets the member's password", reset.status());
    check((await memberCtx.request.get(`${BASE}/api/auth/me`)).status() === 401, "reset signs the member out everywhere");
    check((await login(memberEmail, pw3)).status === 200, "member signs in with the reset password");
    const off = await api.patch(`${BASE}/api/team/${member.id}`, { data: { active: false } });
    check(off.status() === 200, "admin turns the account off", off.status());
    check((await login(memberEmail, pw3)).status === 401, "turned-off account cannot sign in");
  });

  section("Roles");
  let role = null, token = null;
  await safe("roles", async () => {
    const r = await api.post(`${BASE}/api/roles`, { data: { title: `AUDIT E2E Role ${tag}`, description: "About the role\nBackend developer for payments. Safe to delete.", skills: ["Python", "PostgreSQL"] } });
    role = (await r.json()).role; if (role) { state.roles.push(role.id); save(); }
    check(r.status() === 200 || r.status() === 201, "create a role", r.status());
    const list = await (await api.get(`${BASE}/api/roles`)).json();
    check(JSON.stringify(list).includes(role.id), "new role is in the roles list");
    const bad = await api.post(`${BASE}/api/roles`, { data: { title: "" } });
    check(bad.status() === 400, "role without a title refused", bad.status());
    const p = await api.patch(`${BASE}/api/roles/${role.id}`, { data: { title: `AUDIT E2E Role ${tag} edited` } });
    check(p.status() === 200 && (await (await api.get(`${BASE}/api/roles/${role.id}`)).json()).role?.title?.endsWith("edited"), "edit a role's title", p.status());
    const link = await (await api.post(`${BASE}/api/roles/${role.id}/form-link`, { data: {} })).json();
    token = link.token;
    check(!!token, "create the application form link", JSON.stringify(link).slice(0, 200));
    const form = await pub.get(`${BASE}/api/apply/${token}`);
    check(form.status() === 200, "public can open the application form", form.status());
    const sc = await api.patch(`${BASE}/api/roles/${role.id}/screening`, { data: { enabled: true } });
    check(sc.status() === 200, "turn resume screening on", sc.status());
    const af = await api.get(`${BASE}/api/roles/${role.id}/auto-filter`);
    check(af.status() === 200, "read the auto-filter rule", af.status());
    const ai = await api.get(`${BASE}/api/roles/${role.id}/auto-invite`);
    check(ai.status() === 200, "read the automatic invitation settings", ai.status());
    const csv = await api.get(`${BASE}/api/roles/${role.id}/candidates/export`);
    check(csv.status() === 200 && /csv/.test(csv.headers()["content-type"] || ""), "export candidates as CSV", csv.status() + " " + csv.headers()["content-type"]);
  });

  section("Applications and screening");
  let appEmail = `audit.apply.${tag}@example.com`, application = null;
  const apply = async (extra, file, email) => {
    const multipart = { name: "AUDIT Applicant", phone: "9000000088", email: email || `audit.apply.${Math.floor(Math.random() * 1e6)}@example.com`, ...extra, resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: file } };
    const r = await pub.post(`${BASE}/api/apply/${token}`, { multipart });
    return { status: r.status(), body: await r.text() };
  };
  await safe("applications", async () => {
    const fake = await apply({ consent: "true" }, FAKE);
    check(fake.status >= 400, "a file that is not a real PDF is refused", JSON.stringify(fake).slice(0, 160));
    const noConsent = await apply({}, RESUME);
    check(noConsent.status >= 400 && /consent/i.test(noConsent.body), "application without consent refused", noConsent.status);
    const good = await apply({ consent: "true" }, RESUME, appEmail);
    check(good.status === 200, "real application accepted", good.body.slice(0, 200));
    const again = await apply({ consent: "true" }, RESUME, appEmail);
    check(again.status === 200 || again.status === 409, "applying twice with the same email is handled", again.status + " " + again.body.slice(0, 120));
    let apps = [];
    for (let i = 0; i < 12; i++) {
      apps = ((await (await api.get(`${BASE}/api/roles/${role.id}/applications`)).json()).applications) || [];
      application = apps.find((a) => (a.email || a.candidateEmail) === appEmail) || apps[0];
      if (application && (application.screening?.status === "done" || application.match != null || application.screening?.score != null)) break;
      await sleep(5000);
    }
    check(!!application, "application shows on the role", JSON.stringify(apps).slice(0, 200));
    check(apps.filter((a) => (a.email || a.candidateEmail) === appEmail).length === 1, "the same person is listed once", apps.length);
    const scr = await (await api.get(`${BASE}/api/roles/${role.id}/applications/${application.id}/screening`)).json();
    check(JSON.stringify(scr).match(/"score"|"match"|"status":"(done|scored|complete)"/), "resume is screened and scored", JSON.stringify(scr).slice(0, 300));
    const res = await api.get(`${BASE}/api/roles/${role.id}/applications/${application.id}/resume`);
    check(res.status() === 200 && /pdf/.test(res.headers()["content-type"] || ""), "recruiter can open the applicant's resume", res.status());
    const sl = await api.patch(`${BASE}/api/roles/${role.id}/shortlist`, { data: { applicationId: application.id, shortlisted: true } });
    check(sl.status() === 200, "shortlist an applicant", sl.status());
    const cands = await (await api.get(`${BASE}/api/roles/${role.id}/candidates`)).json();
    const cand = (cands.candidates || [])[0];
    check(!!cand, "applicant appears in the candidates list", JSON.stringify(cands).slice(0, 200));
    if (cand) {
      const d = await api.post(`${BASE}/api/roles/${role.id}/candidates/decide`, { data: { decision: "hold", candidateIds: [cand.candidateId], note: "AUDIT" } });
      check(d.status() === 200, "decide on candidates in bulk", d.status() + " " + (await d.text()).slice(0, 150));
      const one = await api.get(`${BASE}/api/roles/${role.id}/candidates/${encodeURIComponent(cand.candidateId)}`);
      check(one.status() === 200, "open one candidate's page data", one.status());
    }
    // Resume upload link for a candidate (upload/[token]) is covered by the
    // application form's own update link, when the app gives one.
    const updateToken = (good.body.match(/"updateToken":"([^"]+)"/) || [])[1];
    if (updateToken) {
      const u = await pub.get(`${BASE}/api/apply/resume/${updateToken}`);
      check(u.status() === 200, "resume update link opens", u.status());
    }
  });

  section("Closing and reopening a role");
  await safe("close", async () => {
    await api.patch(`${BASE}/api/roles/${role.id}`, { data: { status: "completed" } });
    const closed = await apply({ consent: "true" }, RESUME);
    check(closed.status >= 400 && /no longer taking applications/.test(closed.body), "closed role refuses applications", closed.body.slice(0, 120));
    const page = await anon.newPage(); await page.goto(`${BASE}/apply/${token}`, { waitUntil: "networkidle" });
    check((await page.locator("h1").innerText()).includes("closed"), "closed role's form page says it is closed");
    await page.close();
    await api.patch(`${BASE}/api/roles/${role.id}`, { data: { status: "open" } });
    const reopened = await pub.get(`${BASE}/api/apply/${token}`);
    const body = await reopened.text();
    check(reopened.status() === 200 && !/role_closed/.test(body), "reopened role takes applications again", body.slice(0, 160));
  });

  section("Interviews (without starting the voice call)");
  let room = null;
  await safe("interviews", async () => {
    const r = await api.post(`${BASE}/api/interviews`, { multipart: { candidateName: `AUDIT E2E ${tag}`, candidateEmail: `audit.e2e.${tag}@example.com`, roleId: role.id, roleTitle: role.title, durationMinutes: "5", difficulty: "medium", jobDescriptionText: "Backend developer for payments.", resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: RESUME } } });
    const body = await r.json().catch(() => ({})); room = body.room;
    if (room) { state.interviews.push(room.id); save(); }
    check(r.status() === 200 || r.status() === 201, "create an interview with a resume", r.status() + " " + JSON.stringify(body).slice(0, 200));
    const d = await (await api.get(`${BASE}/api/dashboard/interviews/${room.id}`)).json();
    const plan = d.session?.plan || d.plan;
    check(plan && JSON.stringify(plan).length > 200, "interview plan is written (topics and questions)", JSON.stringify(plan).slice(0, 200));
    const list = await (await api.get(`${BASE}/api/dashboard/interviews?limit=50`)).json();
    check(JSON.stringify(list).includes(room.id), "interview shows in the interviews list");
    const ed = await api.patch(`${BASE}/api/interviews/${room.id}/edit`, { multipart: { candidateName: `AUDIT E2E ${tag} edited`, candidateEmail: `audit.e2e.${tag}@example.com`, roleId: role.id, roleTitle: role.title, durationMinutes: "10", difficulty: "hard", jobDescriptionText: "Backend developer for payments." } });
    check(ed.status() === 200, "edit an interview", ed.status() + " " + (await ed.text()).slice(0, 200));
    const cv = await api.get(`${BASE}/api/dashboard/interviews/${room.id}/resume`);
    check([200, 206].includes(cv.status()), "interview resume opens", cv.status());
    // Candidate side: the email gate, without joining (joining starts the voice call).
    const page = await anon.newPage(); await page.goto(`${BASE}/interview/${room.id}`, { waitUntil: "networkidle" });
    const text = await page.innerText("main").catch(() => "");
    check(/email/i.test(text), "candidate link asks for their email first", text.slice(0, 120));
    await page.close();
    const wrong = await pub.post(`${BASE}/api/interviews/${room.id}/verify`, { multipart: { email: "someone.else@example.com", consent: "true" } });
    check(wrong.status() >= 400, "wrong email cannot open the interview", wrong.status());
    const noConsent = await pub.post(`${BASE}/api/interviews/${room.id}/verify`, { multipart: { email: `audit.e2e.${tag}@example.com` } });
    check(noConsent.status() >= 400, "candidate must give consent", noConsent.status());
    const bad = await pub.get(`${BASE}/interview/not-a-real-room-id-000`);
    check(bad.status() < 500, "a broken interview link shows a page, not a crash", bad.status());
    const exp = await api.get(`${BASE}/api/dashboard/interviews/export`);
    check(exp.status() === 200, "export interviews", exp.status() + " " + exp.headers()["content-type"]);
    const an = await api.get(`${BASE}/api/dashboard/interviews/analytics`);
    check(an.status() === 200, "notifications data (bell) loads", an.status());
    const q = await api.get(`${BASE}/api/dashboard/interviews?search=${encodeURIComponent("AUDIT E2E " + tag)}`);
    check(JSON.stringify(await q.json()).includes(room.id), "search finds the interview by name");
    // A second interview, deleted in bulk.
    const r2 = await api.post(`${BASE}/api/interviews`, { multipart: { candidateName: `AUDIT E2E Bulk ${tag}`, candidateEmail: `audit.bulk.${tag}@example.com`, roleId: role.id, roleTitle: role.title, durationMinutes: "5", difficulty: "easy", jobDescriptionText: "Backend developer." } });
    const room2 = (await r2.json()).room;
    if (room2) { state.interviews.push(room2.id); save(); }
    const bd = await api.post(`${BASE}/api/dashboard/interviews/bulk-delete`, { data: { ids: [room2.id] } });
    check(bd.status() === 200 && (await api.get(`${BASE}/api/dashboard/interviews/${room2.id}`)).status() === 404, "bulk delete removes interviews", bd.status());
  });

  section("Reports (on a finished dummy interview)");
  // A finished interview with a report (DONE_ID) and one with a real camera recording (VIDEO_ID).
  const done = process.env.DONE_ID || "RkXLTeG7NKLG7-EthG9EjQ";
  await safe("reports", async () => {
    const d = await (await api.get(`${BASE}/api/dashboard/interviews/${done}`)).json();
    check(d.scorecard?.overall?.score != null, "finished interview has a scored report", JSON.stringify(d.scorecard?.overall));
    // The simulated candidates have no camera; the browser-run interview has a real recording.
    const withVideo = process.env.VIDEO_ID || "wnb2nD2jbRkkkO3VgkBpJg";
    check((await (await api.get(`${BASE}/api/dashboard/interviews/${withVideo}`)).json()).hasRecording === true, "report has its recording");
    const rec = await api.get(`${BASE}/api/dashboard/interviews/${withVideo}/recording`, { maxRedirects: 0 });
    check([200, 206, 302, 307].includes(rec.status()), "recording plays (link works)", rec.status());
    const dl = await api.get(`${BASE}/api/dashboard/interviews/${done}/report/download`);
    check(dl.status() === 200 && Number(dl.headers()["content-length"] || (await dl.body()).length) > 1000, "download the report", dl.status() + " " + dl.headers()["content-type"]);
    const t0 = Date.now(); const rs = await api.post(`${BASE}/api/dashboard/interviews/${done}/regenerate`, { timeout: 300000 });
    check(rs.status() === 200, `re-score works (${Math.round((Date.now() - t0) / 1000)}s)`, rs.status());
    const after = await (await api.get(`${BASE}/api/dashboard/interviews/${done}`)).json();
    const text = JSON.stringify({ s: after.scorecard?.summary, st: after.scorecard?.strengths, c: after.scorecard?.concerns });
    check(!/\b(he|she|his|her|him)\b/i.test(text), "re-written report uses no he/she for the candidate", (text.match(/.{0,40}\b(he|she|his|her|him)\b.{0,20}/i) || [""])[0]);
    const dec = await api.post(`${BASE}/api/dashboard/interviews/${done}/decision`, { data: { outcome: "advance", note: "AUDIT" } });
    const cleared = await api.delete(`${BASE}/api/dashboard/interviews/${done}/decision`);
    check(dec.status() === 200 && cleared.status() === 200, "record and clear a hiring decision", dec.status() + "/" + cleared.status());
    const ask = await api.post(`${BASE}/api/dashboard/interviews/${done}/assistant`, { data: { message: "What did the candidate say about retention of idempotency keys?" }, timeout: 120000 });
    const askBody = await ask.json().catch(() => ({}));
    const answer = JSON.stringify(askBody);
    check(ask.status() === 200 && answer.length > 100, "Ask AI answers about the candidate", ask.status() + " " + answer.slice(0, 200));
    check(!/\b(he|she|his|her)\b/i.test(askBody.answer || askBody.message?.answer || answer), "Ask AI uses no he/she", (answer.match(/.{0,40}\b(he|she|his|her)\b.{0,20}/i) || [""])[0]);
    const convs = await (await api.get(`${BASE}/api/dashboard/interviews/${done}/assistant`)).json();
    const conv = (convs.conversations || [])[0];
    if (conv) {
      const del = await api.delete(`${BASE}/api/dashboard/interviews/${done}/assistant/${conv.id}`);
      check(del.status() === 200 || del.status() === 204, "delete an Ask AI chat", del.status());
    }
  });

  section("Stats, activity and settings");
  await safe("settings", async () => {
    const st = await (await api.get(`${BASE}/api/dashboard/stats`)).json();
    check(st.cost && typeof st.cost.totalUsd === "number", "stats load, with cost");
    const act = await api.get(`${BASE}/api/activity?action=role.created&limit=5`);
    check(act.status() === 200, "activity log filters by action", act.status());
    const before = await (await api.get(`${BASE}/api/settings/agent`)).json();
    const original = before.personality || before;
    const put = await api.put(`${BASE}/api/settings/agent`, { data: { persona: "AUDIT custom persona text for a test.", conduct: original.conduct || "", styles: original.styles || {} } });
    const got = await (await api.get(`${BASE}/api/settings/agent`)).json();
    check(put.status() === 200 && JSON.stringify(got).includes("AUDIT custom persona"), "save custom agent behaviour", put.status());
    const restore = await api.put(`${BASE}/api/settings/agent`, { data: { persona: original.persona || "", conduct: original.conduct || "", styles: original.styles || {} } });
    const back = await (await api.get(`${BASE}/api/settings/agent`)).json();
    check(restore.status() === 200 && !JSON.stringify(back).includes("AUDIT custom persona"), "restore the previous behaviour", restore.status());
    const vp = await api.get(`${BASE}/api/settings/agent/voice-preview?voice=${encodeURIComponent(original.voice || "Sulafat")}`);
    check(vp.status() === 200, "voice sample plays (uses Gemini speech)", vp.status() + " " + (await vp.text()).slice(0, 150));
  });

  section("Pages render cleanly (desktop and phone)");
  await safe("pages", async () => {
    const paths = ["/dashboard", "/dashboard/roles", `/dashboard/roles/${role.id}`, `/dashboard/${done}`, "/dashboard/stats", "/dashboard/settings", "/dashboard/settings/agent", "/dashboard/settings/voice", "/dashboard/settings/team", "/dashboard/settings/activity", room ? `/dashboard/${room.id}/edit` : null].filter(Boolean);
    for (const width of [1440, 390]) {
      const ctx = await signedInContext(b, { viewport: { width, height: 900 } });
      const page = await ctx.newPage(); const errors = [];
      page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      let bad = [];
      for (const p of paths) {
        const r = await page.goto(BASE + p, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (!r || r.status() >= 400 || overflow > 1) bad.push(`${p} status ${r && r.status()} overflow ${overflow}`);
      }
      for (const p of [`/apply/${token}`, "/login"]) {
        const pg = await (await b.newContext({ viewport: { width, height: 900 } })).newPage();
        pg.on("pageerror", (e) => errors.push(e.message));
        const r = await pg.goto(BASE + p, { waitUntil: "networkidle" });
        const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (!r || r.status() >= 400 || overflow > 1) bad.push(`${p} status ${r && r.status()} overflow ${overflow}`);
      }
      check(bad.length === 0, `${paths.length + 2} pages open without errors or sideways scroll at ${width}px`, bad.join("; "));
      check(errors.length === 0, `no JavaScript errors at ${width}px`, errors.slice(0, 3).join(" | "));
      await ctx.close();
    }
  });

  save();
  fs.writeFileSync(`${__dirname}/e2e-results.json`, JSON.stringify(results, null, 1));
  const byArea = {};
  for (const r of results) { byArea[r.area] ??= { pass: 0, total: 0 }; byArea[r.area].total++; if (r.pass) byArea[r.area].pass++; }
  console.log("\n## Summary");
  for (const [k, v] of Object.entries(byArea)) console.log(`${k}: ${v.pass}/${v.total}`);
  const p = results.filter((r) => r.pass).length; console.log(`TOTAL ${p}/${results.length}`);
  await b.close();
})();
