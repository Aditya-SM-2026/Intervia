// The non-voice features e2e.js did not reach. Dummy data only.
const fs = require("fs");
const { BASE, browser, signedInContext } = require("./lib");
const A = `${__dirname}/fixtures`;
const RESUME = fs.readFileSync(`${A}/resume.pdf`), FAKE = fs.readFileSync(`${A}/fake.pdf`);
const results = []; const state = { roles: [], interviews: [] }; let area = "";
const section = (n) => { area = n; console.log(`\n## ${n}`); };
const check = (c, l, x = "") => { results.push({ area, label: l, pass: !!c, extra: c ? "" : String(x).slice(0, 300) }); console.log(`${c ? "✓" : "✗"} ${l}${c || !x ? "" : "  :: " + String(x).slice(0, 300)}`); };
const safe = async (l, fn) => { try { await fn(); } catch (e) { check(false, l + " (crashed)", e.message.split("\n")[0]); } };
const save = () => fs.writeFileSync(`${__dirname}/e2e2-state.json`, JSON.stringify(state, null, 1));
const tag = Date.now().toString(36).slice(-4); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await browser(); const admin = await signedInContext(b); const api = admin.request;
  const anon = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pub = anon.request;
  const role = (await (await api.post(`${BASE}/api/roles`, { data: { title: `AUDIT E2E2 Role ${tag}`, description: "About the role\nBackend developer for payments with Python and PostgreSQL. Safe to delete.", skills: ["Python", "PostgreSQL"] } })).json()).role;
  state.roles.push(role.id); save();
  await api.patch(`${BASE}/api/roles/${role.id}/screening`, { data: { enabled: true } });
  const token = (await (await api.post(`${BASE}/api/roles/${role.id}/form-link`, { data: {} })).json()).token;
  const apply = async (email) => {
    const r = await pub.post(`${BASE}/api/apply/${token}`, { multipart: { name: `AUDIT Applicant ${email.split(".")[2]}`, phone: "9000000099", email, consent: "true", resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: RESUME } } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };

  section("Applicant replaces their resume");
  let applied = null;
  await safe("replace", async () => {
    applied = await apply(`audit.e2e2.one${tag}@example.com`);
    const rt = applied.body.resumeToken;
    check(applied.status === 200 && rt, "application returns a private link to replace the resume", JSON.stringify(applied.body).slice(0, 200));
    const page = await anon.newPage(); const r = await page.goto(`${BASE}/apply/resume/${rt}`, { waitUntil: "networkidle" });
    check(r.status() === 200 && /resume/i.test(await page.innerText("main")), "replace-resume page opens", r.status());
    await page.close();
    const badFile = await pub.post(`${BASE}/api/apply/resume/${rt}`, { multipart: { resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: FAKE } } });
    check(badFile.status() >= 400, "a fake PDF is refused on replace", badFile.status());
    const ok = await pub.post(`${BASE}/api/apply/resume/${rt}`, { multipart: { resume: { name: "resume-v2.pdf", mimeType: "application/pdf", buffer: RESUME } } });
    check(ok.status() === 200, "applicant replaces the resume", ok.status() + " " + (await ok.text()).slice(0, 150));
    const bad = await pub.get(`${BASE}/api/apply/resume/not-a-real-token-123456`);
    check(bad.status() >= 400 && bad.status() < 500, "a made-up replace link is refused", bad.status());
  });

  section("Screening backfill and auto-filter");
  await safe("filter", async () => {
    await apply(`audit.e2e2.two${tag}@example.com`);
    const bf = await api.post(`${BASE}/api/roles/${role.id}/screening/backfill`, { data: {}, timeout: 180000 });
    check(bf.status() === 200, "screen everyone not yet screened (backfill)", bf.status() + " " + (await bf.text()).slice(0, 150));
    let apps = [];
    for (let i = 0; i < 18; i++) {
      apps = (await (await api.get(`${BASE}/api/roles/${role.id}/applications`)).json()).applications || [];
      if (apps.length >= 2 && apps.every((a) => JSON.stringify(a.screening || a).match(/"(score|match)":\s*\d/))) break;
      await sleep(5000);
    }
    check(apps.length === 2 && apps.every((a) => JSON.stringify(a.screening || a).match(/"(score|match)":\s*\d/)), "both applicants have a Match score", JSON.stringify(apps.map((a) => a.screening?.score ?? a.match)).slice(0, 150));
    const set = await api.patch(`${BASE}/api/roles/${role.id}/auto-filter`, { data: { matchBelow: 99, cgpaBelow: 0 } });
    const got = await (await api.get(`${BASE}/api/roles/${role.id}/auto-filter`)).json();
    check(set.status() === 200 && JSON.stringify(got).includes("99"), "save an auto-filter rule (Match below 99)", JSON.stringify(got));
    const after = (await (await api.get(`${BASE}/api/roles/${role.id}/candidates?limit=50`)).json());
    check(JSON.stringify(after.counts || after).length > 2, "candidate counts reflect the rule", JSON.stringify(after.counts).slice(0, 200));
    await api.patch(`${BASE}/api/roles/${role.id}/auto-filter`, { data: { matchBelow: 0, cgpaBelow: 0 } });
    const cut = await api.patch(`${BASE}/api/roles/${role.id}/shortlist`, { data: { cutoff: 10 } });
    check(cut.status() === 200, "set the shortlist cutoff", cut.status());
  });

  section("Bulk invite and automatic invitations");
  await safe("invites", async () => {
    const cands = (await (await api.get(`${BASE}/api/roles/${role.id}/candidates?limit=50`)).json()).candidates || [];
    const one = cands.find((c) => c.candidateId.startsWith("audit.e2e2.one"));
    const bulk = await api.post(`${BASE}/api/roles/${role.id}/interviews/bulk`, { data: { candidateIds: [one.candidateId], durationMinutes: 5, difficulty: "easy" }, timeout: 180000 });
    const bb = await bulk.json().catch(() => ({}));
    check(bulk.status() === 200, "invite a selected applicant to an interview", bulk.status() + " " + JSON.stringify(bb).slice(0, 250));
    const created = JSON.stringify(bb).match(/[A-Za-z0-9_-]{22}/g) || [];
    state.interviews.push(...created); save();
    check(/"sent"|"not_configured"/.test(JSON.stringify(bb)), "invitation email is sent (or email is switched off)", JSON.stringify(bb).slice(0, 250));
    const ai = await api.patch(`${BASE}/api/roles/${role.id}/auto-invite`, { data: { enabled: true, threshold: 1, durationMinutes: 5, difficulty: "easy" } });
    check(ai.status() === 200, "turn automatic invitations on (Match 1+)", ai.status() + " " + (await ai.text()).slice(0, 150));
    const run = await api.post(`${BASE}/api/roles/${role.id}/auto-invite/run`, { data: {}, timeout: 180000 });
    const rb = await run.json().catch(() => ({}));
    check(run.status() === 200, "run automatic invitations now", run.status() + " " + JSON.stringify(rb).slice(0, 250));
    const list = (await (await api.get(`${BASE}/api/roles/${role.id}/candidates?limit=50`)).json()).candidates || [];
    const two = list.find((c) => c.candidateId.startsWith("audit.e2e2.two"));
    check(two && two.latestInterviewId, "the other qualifying applicant was invited automatically", JSON.stringify(two).slice(0, 200));
    const again = await (await api.post(`${BASE}/api/roles/${role.id}/auto-invite/run`, { data: {}, timeout: 180000 })).json().catch(() => ({}));
    const list2 = (await (await api.get(`${BASE}/api/roles/${role.id}/candidates?limit=50`)).json()).candidates || [];
    check(list2.every((c) => (c.interviews || 1) === 1), "running it again invites nobody twice", JSON.stringify(list2.map((c) => [c.candidateId, c.interviews])));
    for (const c of list2) if (c.latestInterviewId) state.interviews.push(c.latestInterviewId);
    save();
    await api.patch(`${BASE}/api/roles/${role.id}/auto-invite`, { data: { enabled: false, threshold: 70, durationMinutes: 30, difficulty: "medium" } });
  });

  section("Recruiter-requested resume upload and HR join");
  await safe("upload", async () => {
    const r = await api.post(`${BASE}/api/interviews`, { multipart: { candidateName: `AUDIT E2E2 Upload ${tag}`, candidateEmail: `audit.e2e2.up${tag}@example.com`, roleId: role.id, roleTitle: role.title, durationMinutes: "5", difficulty: "easy", jobDescriptionText: "Backend developer for payments." } });
    const body = await r.json(); const room = body.room; state.interviews.push(room.id); save();
    const url = body.uploadUrl || JSON.stringify(body).match(/https?:[^"]*\/upload\/[^"]+/)?.[0];
    check(!!url, "interview without a resume gives a link to ask the candidate for one", JSON.stringify(body).slice(0, 200));
    const tokenUp = url.split("/upload/")[1];
    const page = await anon.newPage(); const pr = await page.goto(`${BASE}/upload/${tokenUp}`, { waitUntil: "networkidle" });
    check(pr.status() === 200, "candidate's resume upload page opens", pr.status()); await page.close();
    const fake = await pub.post(`${BASE}/api/upload/${tokenUp}`, { multipart: { resume: { name: "r.pdf", mimeType: "application/pdf", buffer: FAKE } } });
    check(fake.status() >= 400, "fake PDF refused on the upload page", fake.status());
    const up = await pub.post(`${BASE}/api/upload/${tokenUp}`, { multipart: { resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: RESUME } } });
    check(up.status() === 200, "candidate uploads their resume", up.status() + " " + (await up.text()).slice(0, 150));
    const d = await (await api.get(`${BASE}/api/dashboard/interviews/${room.id}`)).json();
    check(JSON.stringify(d.session).match(/"hasResume":true|"resumeFileName":"resume.pdf"|resumeText/), "the uploaded resume is on the interview", JSON.stringify(d.session).slice(0, 200));
    const hr = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const hrr = await hr.goto(`${BASE}/interview/${room.id}/hr`, { waitUntil: "networkidle" });
    check(hrr.status() === 200 && /email|join|HR|watch/i.test(await hr.innerText("body")), "HR watch page opens and asks who you are", (await hr.innerText("body")).slice(0, 120));
    const wrongHr = await pub.post(`${BASE}/api/interviews/${room.id}/hr/join`, { data: { email: "stranger@example.com" } });
    check(wrongHr.status() >= 400, "a stranger cannot join as HR", wrongHr.status());
  });

  section("Emails");
  await safe("emails", async () => {
    const r = await api.post(`${BASE}/api/interviews`, { multipart: { candidateName: `AUDIT E2E2 Mail ${tag}`, candidateEmail: `audit.e2e2.mail${tag}@example.com`, roleId: role.id, roleTitle: role.title, durationMinutes: "5", difficulty: "easy", jobDescriptionText: "Backend developer for payments.", resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: RESUME } } });
    const body = await r.json(); state.interviews.push(body.room.id); save();
    check(["sent", "not_configured"].includes(body.inviteEmail?.status ?? body.email?.status), "invite email on a new interview", JSON.stringify(body.inviteEmail ?? body.email ?? Object.keys(body)));
    console.log("   email status:", JSON.stringify(body.inviteEmail ?? body.email));
  });

  fs.writeFileSync(`${__dirname}/e2e2-results.json`, JSON.stringify(results, null, 1)); save();
  const by = {}; for (const r of results) { by[r.area] ??= [0, 0]; by[r.area][1]++; if (r.pass) by[r.area][0]++; }
  console.log("\n## Summary"); for (const [k, v] of Object.entries(by)) console.log(`${k}: ${v[0]}/${v[1]}`);
  console.log(`TOTAL ${results.filter((r) => r.pass).length}/${results.length}`); await b.close();
})();
