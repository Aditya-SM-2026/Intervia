import "server-only";
import { Pool } from "pg";
import { sharedPool } from "@/server/db/pool";

/**
 * Shared, database-backed request counters.
 *
 * The older guards in this app kept their counts in the memory of one Cloud
 * Run instance, so the real ceiling depended on how many instances happened to
 * serve a burst, and every cold start reset the budget. These counters live in
 * Postgres, so all instances, both environments (one database each) and every
 * revision see the same numbers.
 */

const globalRefs = globalThis as unknown as {
  __rateLimitPgPool?: Pool;
  __rateLimitSchema?: Promise<void>;
};

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS request_rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits INT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_rate_limits_window_idx
  ON request_rate_limits (window_start);
`;

function getPool(): Pool {
  if (!globalRefs.__rateLimitPgPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; cannot use the rate limit store");
    }
    globalRefs.__rateLimitPgPool = sharedPool(connectionString);
  }
  return globalRefs.__rateLimitPgPool;
}

async function ensureSchema(): Promise<void> {
  if (!globalRefs.__rateLimitSchema) {
    globalRefs.__rateLimitSchema = getPool()
      .query(BOOTSTRAP_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalRefs.__rateLimitSchema = undefined;
        throw error;
      });
  }
  await globalRefs.__rateLimitSchema;
}

/** Rows older than this are dropped now and then; nobody queries them. */
const KEEP_DAYS = 2;

function maybeCleanup(): void {
  if (Math.random() > 0.01) return;
  getPool()
    .query(`DELETE FROM request_rate_limits WHERE window_start < now() - interval '${KEEP_DAYS} days'`)
    .catch((error: unknown) => {
      console.error(`[rate-limit] cleanup failed: ${describeError(error)}`);
    });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Count one request against a key and return how many times the key has been
 * seen in the current window.
 *
 * The insert and the increment happen in one statement so two instances
 * serving the same key at the same moment cannot both read the old count.
 */
export async function hitRateLimit(key: string, windowSeconds: number): Promise<number> {
  await ensureSchema();
  const result = await getPool().query<{ hits: number }>(
    `INSERT INTO request_rate_limits (key, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2::double precision) * $2::double precision), 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE
         WHEN request_rate_limits.window_start >= EXCLUDED.window_start
           THEN request_rate_limits.hits + 1
         ELSE 1
       END,
       window_start = EXCLUDED.window_start
     RETURNING hits`,
    [key, windowSeconds],
  );
  maybeCleanup();
  return Number(result.rows[0]?.hits ?? 1);
}
