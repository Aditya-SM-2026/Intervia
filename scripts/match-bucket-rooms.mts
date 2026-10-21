import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() });
const bucketRooms = (await import("node:fs")).readFileSync(process.argv[2], "utf8")
  .split(/\r?\n/).filter(Boolean);
const r = await pool.query(
  `SELECT i.id, i.role_title, i.status, i.created_at,
          (SELECT count(*) FROM scorecards s WHERE s.room_id = i.id) AS has_scorecard
   FROM interviews i WHERE i.id = ANY(string_to_array($1, '|')) AND i.status = 'completed'
   ORDER BY i.created_at DESC`,
  [bucketRooms.join("|")],
);
r.rows.forEach((x) => console.log(x.id, "|", x.role_title, "|", x.created_at, "| scorecard:", x.has_scorecard));
await pool.end();