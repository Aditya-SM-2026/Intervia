import "server-only";
import { Pool } from "pg";
import type {
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
} from "@/lib/interviews/interview.types";

/**
 * Postgres-backed interview room store (Cloud SQL in production).
 * The schema is bootstrapped idempotently on first use so a fresh database
 * needs no separate migration step.
 */

interface GlobalWithPool {
  __interviewPgPool?: Pool;
  __interviewPgBootstrap?: Promise<void>;
}

const globalRefs = globalThis as unknown as GlobalWithPool;

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  candidate_name TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ
);
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS agent_claimed_by TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS agent_claimed_at TIMESTAMPTZ;
`;

function getPool(): Pool {
  if (!globalRefs.__interviewPgPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; cannot use the Postgres repository");
    }
    globalRefs.__interviewPgPool = new Pool({ connectionString, max: 5 });
  }
  return globalRefs.__interviewPgPool;
}

async function ensureSchema(): Promise<void> {
  if (!globalRefs.__interviewPgBootstrap) {
    globalRefs.__interviewPgBootstrap = getPool()
      .query(BOOTSTRAP_SQL)
      .then(() => undefined);
  }
  await globalRefs.__interviewPgBootstrap;
}

interface InterviewRow {
  id: string;
  title: string;
  candidate_name: string | null;
  status: string;
  created_at: Date;
  expires_at: Date | null;
}

function rowToRoom(row: InterviewRow): InterviewRoom {
  return {
    id: row.id,
    title: row.title,
    candidateName: row.candidate_name,
    status: row.status as InterviewStatus,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  };
}

export function getPostgresInterviewRepository(): InterviewRepository {
  return {
    async save(room: InterviewRoom): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO interviews (id, title, candidate_name, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           candidate_name = EXCLUDED.candidate_name,
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
        [
          room.id,
          room.title,
          room.candidateName,
          room.status,
          room.createdAt,
          room.expiresAt,
        ],
      );
    },

    async get(id: string): Promise<InterviewRoom | null> {
      await ensureSchema();
      const result = await getPool().query<InterviewRow>(
        "SELECT id, title, candidate_name, status, created_at, expires_at FROM interviews WHERE id = $1",
        [id],
      );
      const row = result.rows[0];
      return row ? rowToRoom(row) : null;
    },

    async claimForAgent(roomId: string, workerId: string, ttlSeconds: number): Promise<boolean> {
      await ensureSchema();
      // Atomic conditional update: the row lock makes the check-and-set a
      // single step, so concurrent workers cannot both win.
      const result = await getPool().query(
        `UPDATE interviews
         SET agent_claimed_by = $2, agent_claimed_at = now()
         WHERE id = $1
           AND (agent_claimed_by IS NULL
                OR agent_claimed_by = ''
                OR agent_claimed_at IS NULL
                OR agent_claimed_at < now() - make_interval(secs => $3))
         RETURNING id`,
        [roomId, workerId, ttlSeconds],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async releaseAgentClaim(roomId: string, workerId: string): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `UPDATE interviews
         SET agent_claimed_by = NULL, agent_claimed_at = NULL
         WHERE id = $1 AND agent_claimed_by = $2`,
        [roomId, workerId],
      );
    },
  };
}