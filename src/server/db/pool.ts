import { Pool } from "pg";

/**
 * One database pool per server instance, shared by every repository.
 *
 * Each repository used to open its own pool (15 connections per instance in
 * all). With several Cloud Run instances per environment and two
 * environments on one small database (25 connections, a few reserved for
 * Google), a busy day could ask for far more than the database allows, and
 * pages failed. One shared pool of DB_POOL_MAX (default 3) keeps both
 * environments at full scale (3 instances each) at 18 connections.
 */

export const DEFAULT_POOL_MAX = 3;

const globalRefs = globalThis as unknown as { __sharedPgPool?: Pool; __sharedPgPoolUrl?: string };

export function poolMaxFrom(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : DEFAULT_POOL_MAX;
}

export function sharedPool(connectionString: string): Pool {
  if (!globalRefs.__sharedPgPool || globalRefs.__sharedPgPoolUrl !== connectionString) {
    const pool = new Pool({
      connectionString,
      max: poolMaxFrom(process.env.DB_POOL_MAX),
      // Give connections back when the instance goes quiet.
      idleTimeoutMillis: 30_000,
    });
    // An idle connection dropped by the database must not crash the server.
    pool.on("error", (error) => {
      console.error(`[db] idle connection error: ${error.message}`);
    });
    globalRefs.__sharedPgPool = pool;
    globalRefs.__sharedPgPoolUrl = connectionString;
  }
  return globalRefs.__sharedPgPool;
}
