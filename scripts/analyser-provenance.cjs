/**
 * Provenance report: which analyser scored each interview's video.
 *
 *   node scripts/analyser-provenance.cjs "<DATABASE_URL>"
 *
 * Prints one line per interview with the stored video model, so it is
 * verifiable from the database rather than from the report UI. "local-cv"
 * means the OpenCV + MediaPipe analyser (video-analysis/analyse.py) did it;
 * anything else (ominibot, gemini-*) came from a vision LLM.
 */
const { Client } = require("pg");

(async () => {
  const url = process.argv[2] || process.env.DATABASE_URL;
  if (!url) {
    console.error("Pass a DATABASE_URL or set the environment variable.");
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  await c.connect();

  const rows = (
    await c.query(
      `select s.room_id, s.scorecard, s.generated_at, i.candidate_name, i.role_title
         from scorecards s
         left join interviews i on i.id = s.room_id
        order by s.generated_at desc`,
    )
  ).rows;

  const pad = (v, n) => String(v ?? "").padEnd(n).slice(0, n);
  console.log(
    `${pad("ROOM", 20)}${pad("CANDIDATE", 24)}${pad("ROLE", 24)}${pad("GENERATED", 22)}ANALYSER`,
  );
  let local = 0;
  let llm = 0;
  for (const row of rows) {
    const video = (row.scorecard || {}).video || {};
    const analyser = video.model || `- (${video.status || "no video"})`;
    if (analyser.startsWith("local-cv")) local += 1;
    else if (video.model) llm += 1;
    console.log(
      `${pad(row.room_id, 20)}${pad(row.candidate_name, 24)}${pad(row.role_title, 24)}${pad(
        new Date(row.generated_at).toISOString().slice(0, 16).replace("T", " "),
        22,
      )}${analyser}`,
    );
  }
  console.log(`\nOpenCV + MediaPipe (local-cv): ${local}   Vision LLM: ${llm}   Total reports: ${rows.length}`);
  await c.end();
})().catch((error) => {
  console.error("failed:", error.message);
  process.exit(1);
});