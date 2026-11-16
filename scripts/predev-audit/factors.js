const { BASE, browser, signedInContext } = require("./lib");
(async () => { const b = await browser(); const ctx = await signedInContext(b);
  for (const id of process.argv.slice(2)) {
    const d = await (await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`)).json(); const s = d.scorecard;
    console.log(`== ${d.session.candidateName}: overall ${JSON.stringify(s.overall)} suggestion=${s.suggestion} overallScore(1-5)=${s.overallScore}`);
    console.log("   competencies:", JSON.stringify((s.competencies || []).map((c) => ({ score: c.score, status: c.status, verdict: c.verdict }))));
    console.log("   integrity:", s.integrityCheck?.level, JSON.stringify((s.integrityCheck?.findings || []).map((f) => `${f.source}/${f.kind}/${f.strength}: ${f.title}`)));
    console.log("   resume:", JSON.stringify(s.resume ? { score: s.resume.score, status: s.resume.status } : null), " video:", s.video?.status, s.video?.reason?.slice(0, 80));
  } await b.close(); })();
