import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() });
const r = await pool.query(
  "SELECT room_id, type, data FROM interview_events WHERE type IN ('recording_started','recording_uploaded') ORDER BY at DESC LIMIT 15",
);
r.rows.forEach((x) => console.log(x.room_id, x.type, JSON.stringify(x.data).slice(0, 160)));
await pool.end();