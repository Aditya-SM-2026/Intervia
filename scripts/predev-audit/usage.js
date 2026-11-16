const fs = require("fs"); const { BASE, browser, signedInContext } = require("./lib");
const R = { ai: 3.0, ti: 0.75, ao: 12.0, to: 4.5 };
(async () => { const b = await browser(); const ctx = await signedInContext(b);
  const ids = new Map();
  for (const f of fs.readdirSync(".").filter(f => /^setup-.*\.json$/.test(f))) for (const i of JSON.parse(fs.readFileSync(f)).interviews) ids.set(i.id, f.slice(6,-5)+" "+i.persona);
  ids.set("wnb2nD2jbRkkkO3VgkBpJg", "browser");
  let T = { ai:0, ti:0, ao:0, to:0, usd:0, sec:0, n:0, missing:0 };
  for (const [id, label] of ids) {
    const r = await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`);
    if (r.status() !== 200) { T.missing++; console.log(label, id, "gone", r.status()); continue; }
    const o = (await r.json()).session.outcome; if (!o) { console.log(label, "no outcome"); continue; }
    let ai=0, ti=0, ao=0, to=0;
    for (const u of o.usage || []) { const a=u.input_audio_tokens||0, c=u.output_audio_tokens||0; ai+=a; ao+=c; ti+=Math.max(0,(u.input_tokens||0)-a); to+=Math.max(0,(u.output_tokens||0)-c); }
    const usd = (ai*R.ai + ti*R.ti + ao*R.ao + to*R.to)/1e6;
    T.ai+=ai; T.ti+=ti; T.ao+=ao; T.to+=to; T.usd+=usd; T.sec+=o.elapsedSeconds||0; T.n++;
    console.log(label.padEnd(18), String(Math.round(o.elapsedSeconds||0)).padStart(4)+"s", "audioIn", ai, "textIn", ti, "audioOut", ao, "textOut", to, "$"+usd.toFixed(4));
  }
  console.log("TOTAL", JSON.stringify({ interviews: T.n, missing: T.missing, minutes: +(T.sec/60).toFixed(1), audioIn: T.ai, textIn: T.ti, audioOut: T.ao, textOut: T.to, usd: +T.usd.toFixed(2) }));
  await b.close(); })();
