const { BASE, browser, signedInContext } = require("./lib");
(async () => { const b = await browser(); const ctx = await signedInContext(b);
  for (const id of process.argv.slice(2)) {
    const d = await (await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`)).json();
    const s = d.scorecard; const turns = (d.turns || []);
    console.log(`== ${d.session?.candidateName} ${id} status=${d.session?.status} turns=${turns.length} (candidate ${turns.filter(t=>t.speaker==="candidate").length}) reason=${d.reason ?? ""}`);
    if (s) console.log(`   overall=${s.overall?.score} suggestion=${s.suggestion} video=${s.video?.status} integrity=${s.integrityCheck?.level}\n   summary: ${(s.summary || s.headline || "").slice(0, 300)}`);
    if (process.env.TURNS) for (const t of turns) console.log(`   ${t.speaker.padEnd(11)} ${String(t.text).slice(0, 260)}`);
  } await b.close(); })();
