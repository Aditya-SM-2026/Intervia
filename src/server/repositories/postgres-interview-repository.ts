import "server-only";
import { Pool } from "pg";
import type {
  DifficultyLevel,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
  InterviewTurn,
  InterviewTurnInput,
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
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS recruiter_name TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_email TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS role_title TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS difficulty TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS jd_source TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS jd_text TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_file_name TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_text TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_unreadable BOOLEAN;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS interviews_candidate_email_idx ON interviews (candidate_email);
CREATE TABLE IF NOT EXISTS interview_turns (
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  asked_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  latency_ms INTEGER,
  PRIMARY KEY (room_id, seq)
);
CREATE INDEX IF NOT EXISTS interview_turns_room_idx ON interview_turns (room_id, seq);
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
      .then(() => undefined)
      .catch((error: unknown) => {
        // Allow a retry on the next request; a cached rejection (e.g. the
        // database briefly unreachable at boot) would otherwise poison every
        // future call in this process.
        globalRefs.__interviewPgBootstrap = undefined;
        throw error;
      });
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
  recruiter_name: string | null;
  candidate_email: string | null;
  role_title: string | null;
  difficulty: string | null;
  duration_minutes: number | null;
  jd_source: string | null;
  jd_text: string | null;
  resume_file_name: string | null;
  resume_text: string | null;
  resume_unreadable: boolean | null;
  consent_given_at: Date | null;
  completed_at: Date | null;
}

function rowToRoom(row: InterviewRow): InterviewRoom {
  const jdText = row.jd_text;
  return {
    id: row.id,
    title: row.title,
    candidateName: row.candidate_name,
    status: row.status as InterviewStatus,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    recruiterName: row.recruiter_name,
    candidateEmail: row.candidate_email,
    roleTitle: row.role_title,
    difficulty: (row.difficulty as DifficultyLevel | null) ?? "medium",
    durationMinutes: row.duration_minutes ?? 5,
    jobDescription:
      jdText !== null && (row.jd_source === "text" || row.jd_source === "pdf")
        ? { source: row.jd_source, text: jdText }
        : null,
    resume:
      row.resume_file_name !== null
        ? {
            fileName: row.resume_file_name,
            text: row.resume_text ?? "",
            ...(row.resume_unreadable ? { unreadable: true } : {}),
          }
        : null,
    consent: row.consent_given_at ? { givenAt: row.consent_given_at.toISOString() } : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

export function getPostgresInterviewRepository(): InterviewRepository {
  return {
    async save(room: InterviewRoom): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO interviews (id, title, candidate_name, status, created_at, expires_at,
             recruiter_name, candidate_email, role_title, difficulty, duration_minutes, jd_source, jd_text,
             resume_file_name, resume_text, resume_unreadable, consent_given_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           candidate_name = EXCLUDED.candidate_name,
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           recruiter_name = EXCLUDED.recruiter_name,
           candidate_email = EXCLUDED.candidate_email,
           role_title = EXCLUDED.role_title,
           difficulty = EXCLUDED.difficulty,
           duration_minutes = EXCLUDED.duration_minutes,
           jd_source = EXCLUDED.jd_source,
           jd_text = EXCLUDED.jd_text,
           resume_file_name = EXCLUDED.resume_file_name,
           resume_text = EXCLUDED.resume_text,
           resume_unreadable = EXCLUDED.resume_unreadable,
           consent_given_at = EXCLUDED.consent_given_at,
           completed_at = EXCLUDED.completed_at`,
        [
          room.id,
          room.title,
          room.candidateName,
          room.status,
          room.createdAt,
          room.expiresAt,
          room.recruiterName,
          room.candidateEmail,
          room.roleTitle,
          room.difficulty,
          room.durationMinutes,
          room.jobDescription?.source ?? null,
          room.jobDescription?.text ?? null,
          room.resume?.fileName ?? null,
          room.resume?.text ?? null,
          room.resume?.unreadable ?? null,
          room.consent?.givenAt ?? null,
          room.completedAt,
        ],
      );
    },

    async get(id: string): Promise<InterviewRoom | null> {
      await ensureSchema();
      const result = await getPool().query<InterviewRow>(
        `SELECT id, title, candidate_name, status, created_at, expires_at,
              recruiter_name, candidate_email, role_title, difficulty, duration_minutes, jd_source, jd_text,
              resume_file_name, resume_text, resume_unreadable, consent_given_at, completed_at
         FROM interviews WHERE id = $1`,
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

    async appendTurn(roomId: string, turn: InterviewTurnInput): Promise<void> {
      await ensureSchema();
      // The sub-select assigns the next sequence number atomically under the
      // row lock of the aggregate, so concurrent appends stay ordered.
      await getPool().query(
        `INSERT INTO interview_turns (room_id, seq, speaker, text, asked_at, answered_at, latency_ms)
         VALUES ($1,
                 (SELECT COALESCE(MAX(seq), 0) + 1 FROM interview_turns WHERE room_id = $1),
                 $2, $3, $4, $5, $6)`,
        [roomId, turn.speaker, turn.text, turn.askedAt, turn.answeredAt, turn.latencyMs],
      );
    },

    async getTurns(roomId: string): Promise<InterviewTurn[]> {
      await ensureSchema();
      const result = await getPool().query<TurnRow>(
        `SELECT room_id, seq, speaker, text, asked_at, answered_at, latency_ms
         FROM interview_turns WHERE room_id = $1 ORDER BY seq ASC`,
        [roomId],
      );
      return result.rows.map(turnRowToTurn);
    },

    async completeSession(roomId: string): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `UPDATE interviews
         SET status = 'completed', completed_at = now()
         WHERE id = $1 AND status IN ('scheduled', 'waiting', 'active')`,
        [roomId],
      );
    },
  };
}

interface TurnRow {
  room_id: string;
  seq: number;
  speaker: string;
  text: string;
  asked_at: Date | null;
  answered_at: Date | null;
  latency_ms: number | null;
}

function turnRowToTurn(row: TurnRow): InterviewTurn {
  return {
    roomId: row.room_id,
    seq: row.seq,
    speaker: row.speaker === "candidate" ? "candidate" : "interviewer",
    text: row.text,
    askedAt: row.asked_at ? row.asked_at.toISOString() : null,
    answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
    latencyMs: row.latency_ms,
  };
}