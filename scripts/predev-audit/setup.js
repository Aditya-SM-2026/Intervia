const fs = require("fs");
const { BASE, browser, signedInContext } = require("./lib");
(async () => {
  const b = await browser(); const ctx = await signedInContext(b); const api = ctx.request;
  const role = process.env.ROLE ? { id: process.env.ROLE, title: "AUDIT AI Eval Backend Developer" } : (await (await api.post(BASE + "/api/roles", { data: { title: "AUDIT AI Eval Backend Developer", description: fs.readFileSync(__dirname + "/jd.txt", "utf8"), skills: ["Python", "PostgreSQL", "REST APIs", "Idempotency", "Testing"] } })).json()).role;
  const stamp = Date.now().toString(36).slice(-4);
  const personas = (process.argv[2] || "strong,vague,evasive").split(",");
  const out = { roleId: role.id, interviews: [] };
  for (const persona of personas) {
    const email = `audit.eval.${persona}.${stamp}@example.com`;
    const r = await api.post(BASE + "/api/interviews", { multipart: {
      candidateName: `AUDIT Eval ${persona}`, candidateEmail: email, roleId: role.id, roleTitle: role.title,
      durationMinutes: process.argv[3] || "5", difficulty: "medium", jobDescriptionText: fs.readFileSync(__dirname + "/jd.txt", "utf8"),
      resume: { name: "resume.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(__dirname + "/fixtures/eval-resume.pdf") } } });
    const body = await r.json();
    out.interviews.push({ persona, email, id: body.room?.id, status: r.status(), topics: body.room?.plan?.competencies?.map((c) => c.name || c.title) });
  }
  fs.writeFileSync(__dirname + `/setup-${process.env.TAG || "x"}.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
