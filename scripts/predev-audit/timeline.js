const { BASE, browser, signedInContext } = require("./lib");
(async () => { const b = await browser(); const ctx = await signedInContext(b);
  for (const id of process.argv.slice(2)) {
  const d = await (await ctx.request.get(`${BASE}/api/dashboard/interviews/${id}`)).json();
  const ev = d.events || []; const t0 = new Date((ev.find(e=>e.type==="interview_started")||ev[0]).createdAt||ev[0].at).getTime();
  console.log("==", id);
  for (const e of ev) { if (["agent_state","candidate_state"].includes(e.type)) continue; const t=new Date(e.createdAt||e.at).getTime();
    console.log(((t-t0)/1000).toFixed(1), e.type, JSON.stringify(e.payload||e.data||{}).slice(0,160)); } }
  await b.close(); })();
