import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();
const pool = new pg.Pool({ connectionString: url });
const roomId = process.argv[2];
const r = await pool.query(
    "SELECT type, at, data FROM interview_events WHERE room_id = $1 ORDER BY seq ASC",
    [roomId],
  );
  r.rows.forEach((e) => console.log(e.type, e.at, JSON.stringify(e.data).slice(0, 200)));
await pool.end();