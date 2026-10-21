import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();
const pool = new pg.Pool({ connectionString: url });
const rooms = process.argv.slice(2);
const sql = `SELECT id, role_title, status, created_at FROM interviews
  WHERE id = ANY($1)`;
console.log((await pool.query(sql, [rooms])).rows);
await pool.end();