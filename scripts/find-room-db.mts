import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const base = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
const admin = new pg.Pool({ connectionString: base.replace(/\/[^/]+$/, "/postgres") });
const dbs = (await admin.query("SELECT datname FROM pg_database WHERE datistemplate=false")).rows;
for (const { datname } of dbs) {
  const pool = new pg.Pool({ connectionString: base.replace(/\/[^/]+$/, "/" + datname) });
  try {
    const r = await pool.query("SELECT room_id, count(*) FROM interview_events WHERE room_id LIKE 'WS3O%' GROUP BY room_id");
    if (r.rows.length) console.log(datname, r.rows);
  } catch { /* table missing in that db */ }
  await pool.end();
}
await admin.end();