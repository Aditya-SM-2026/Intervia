import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() });
const rooms = process.argv.slice(2);
for (const roomId of rooms) {
  const r = await pool.query("SELECT scorecard, generated_at FROM scorecards WHERE room_id = $1", [roomId]);
  const card = r.rows[0]?.scorecard;
  if (!card) { console.log(roomId, "no scorecard"); continue; }
  const video = card.videoBehaviour ?? card.video ?? null;
  if (!video) { console.log(roomId, "scorecard has no video behaviour"); continue; }
  const out = path.join("media", `stored-llm-${roomId}.json`);
  writeFileSync(out, JSON.stringify(video, null, 2));
  console.log(roomId, "status=", video.status, "answers=", video.answers?.length ?? 0,
    "moments=", video.moments?.length ?? 0, "attention=", video.attentionPercent,
    "model=", video.model, "->", out);
}
await pool.end();