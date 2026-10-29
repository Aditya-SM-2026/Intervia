import "server-only";
import { Pool } from "pg";
import type {
  DashboardListFilter,
  DifficultyLevel,
  HumanDecision,
  InterviewEvent,
  InterviewEventInput,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
  InterviewTurn,
  InterviewTurnInput,
  SessionOutcome,
} from "@/lib/interviews/interview.types";
import type { InterviewPlan } from "@/lib/interviews/plan.types";
import type { Scorecard, ScorecardSummary } from "@/lib/interviews/scorecard.types";

/**
 * Postgres-backed store (Cloud SQL in production). The schema is bootstrapped
 * idempotently on first use, so a fresh database needs no migration step and
 * an existing v1 database gains the v2 columns and tables in place. v1 data
 * (the old `reports` table and turn timing columns) is left untouched and
 * simply no longer read.
 */

interface GlobalWithPool {
  __interviewPgPool?: Pool;
  __interviewPgBootstrapV2?: Promise<void>;
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
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS recruiter_name TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_email TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS role_title TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS difficulty TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS voice_mode TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS jd_source TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS jd_text TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_file_name TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_text TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_unreadable BOOLEAN;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS resume_object_path TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS upload_token TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS upload_used_at TIMESTAMPTZ;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS plan JSONB;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS outcome JSONB;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS decision JSONB;
CREATE INDEX IF NOT EXISTS interviews_candidate_email_idx ON interviews (candidate_email);
CREATE TABLE IF NOT EXISTS interview_turns (
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (room_id, seq)
);
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS response_latency_ms INTEGER;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS interrupted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE interview_turns ADD COLUMN IF NOT EXISTS competency_id TEXT;
CREATE TABLE IF NOT EXISTS interview_events (
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (room_id, seq)
);
CREATE TABLE IF NOT EXISTS scorecards (
  room_id TEXT PRIMARY KEY,
  scorecard JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const ROOM_COLUMNS = `id, title, candidate_name, status, created_at, expires_at,
recruiter_name, scheduled_at, candidate_email, role_title, role_id, difficulty, duration_minutes, jd_source, jd_text,
  resume_file_name, resume_text, resume_unreadable, consent_given_at, completed_at,
  plan, outcome, decision, voice_mode, reminder_sent_at, upload_token, upload_used_at, resume_object_path`;

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
  if (!globalRefs.__interviewPgBootstrapV2) {
    globalRefs.__interviewPgBootstrapV2 = getPool()
      .query(BOOTSTRAP_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Allow a retry on the next request; a cached rejection (e.g. the
        // database briefly unreachable at boot) would otherwise poison every
        // future call in this process.
        globalRefs.__interviewPgBootstrapV2 = undefined;
        throw error;
      });
  }
  await globalRefs.__interviewPgBootstrapV2;
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
  role_id: string | null;
  difficulty: string | null;
  duration_minutes: number | null;
  jd_source: string | null;
  jd_text: string | null;
  resume_file_name: string | null;
  resume_text: string | null;
  resume_unreadable: boolean | null;
  resume_object_path: string | null;
  consent_given_at: Date | null;
  completed_at: Date | null;
  scheduled_at: Date | null;
  reminder_sent_at: Date | null;
  upload_token: string | null;
  upload_used_at: Date | null;
  plan: InterviewPlan | null;
  outcome: SessionOutcome | null;
  decision: HumanDecision | null;
  voice_mode: string | null;
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
    scheduledAt: row.scheduled_at ? row.scheduled_at.toISOString() : null,
    reminderSentAt: row.reminder_sent_at ? row.reminder_sent_at.toISOString() : null,
    uploadToken: row.upload_token,
    uploadUsedAt: row.upload_used_at ? row.upload_used_at.toISOString() : null,
    candidateEmail: row.candidate_email,
    roleTitle: row.role_title,
    roleId: row.role_id,
    difficulty: (row.difficulty as DifficultyLevel | null) ?? "medium",
    durationMinutes: row.duration_minutes ?? 15,
    voiceMode: row.voice_mode === "rolling" ? "rolling" : "standard",
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
            ...(row.resume_object_path ? { objectPath: row.resume_object_path } : {}),
          }
        : null,
    consent: row.consent_given_at ? { givenAt: row.consent_given_at.toISOString() } : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    plan: row.plan ?? null,
    outcome: row.outcome ?? null,
    decision: row.decision ?? null,
  };
}

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function getPostgresInterviewRepository(): InterviewRepository {
  return {
    async save(room: InterviewRoom): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO interviews (${ROOM_COLUMNS})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           candidate_name = EXCLUDED.candidate_name,
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           recruiter_name = EXCLUDED.recruiter_name,
           scheduled_at = EXCLUDED.scheduled_at,
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
           completed_at = EXCLUDED.completed_at,
           plan = EXCLUDED.plan,
           outcome = EXCLUDED.outcome,
           decision = EXCLUDED.decision,
           voice_mode = EXCLUDED.voice_mode,
role_id = EXCLUDED.role_id,
           reminder_sent_at = EXCLUDED.reminder_sent_at,
           upload_token = EXCLUDED.upload_token,
           upload_used_at = EXCLUDED.upload_used_at,
           resume_object_path = EXCLUDED.resume_object_path`,
        [
          room.id,
          room.title,
          room.candidateName,
          room.status,
          room.createdAt,
          room.expiresAt,
          room.recruiterName,
          room.scheduledAt,
          room.candidateEmail,
          room.roleTitle,
          room.roleId,
          room.difficulty,
          room.durationMinutes,
          room.jobDescription?.source ?? null,
          room.jobDescription?.text ?? null,
          room.resume?.fileName ?? null,
          room.resume?.text ?? null,
          room.resume?.unreadable ?? null,
          room.consent?.givenAt ?? null,
          room.completedAt,
          jsonOrNull(room.plan),
          jsonOrNull(room.outcome),
          jsonOrNull(room.decision),
          room.voiceMode,
          room.reminderSentAt,
          room.uploadToken,
          room.uploadUsedAt,
          room.resume?.objectPath ?? null,
        ],
      );
    },

    async insertRoomAtomically(
      room: InterviewRoom,
      duplicateKey: string,
    ): Promise<{ created: true } | { created: false; existing: InterviewRoom }> {
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        // One writer per logical slot: identical candidate + role + schedule
        // serialize here, so the duplicate check inside the transaction is
        // race-free.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [duplicateKey]);
        const existing = await client.query<InterviewRow>(
          `SELECT ${ROOM_COLUMNS} FROM interviews
           WHERE candidate_email = $1
             AND lower(role_title) = lower($2)
             AND status = 'scheduled'
             AND completed_at IS NULL
             AND ((scheduled_at IS NULL AND $3::timestamptz IS NULL)
                  OR scheduled_at = $3::timestamptz)
           LIMIT 1`,
          [room.candidateEmail, room.roleTitle, room.scheduledAt],
        );
        if (existing.rows.length > 0) {
          await client.query("COMMIT");
          return { created: false, existing: rowToRoom(existing.rows[0]) };
        }
        await client.query(
          `INSERT INTO interviews (${ROOM_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
          [
            room.id,
            room.title,
            room.candidateName,
            room.status,
            room.createdAt,
            room.expiresAt,
            room.recruiterName,
            room.scheduledAt,
            room.candidateEmail,
            room.roleTitle,
            room.roleId,
            room.difficulty,
            room.durationMinutes,
            room.jobDescription?.source ?? null,
            room.jobDescription?.text ?? null,
            room.resume?.fileName ?? null,
            room.resume?.text ?? null,
            room.resume?.unreadable ?? null,
            room.consent?.givenAt ?? null,
            room.completedAt,
            jsonOrNull(room.plan),
            jsonOrNull(room.outcome),
            jsonOrNull(room.decision),
            room.voiceMode,
            room.reminderSentAt,
            room.uploadToken,
            room.uploadUsedAt,
            room.resume?.objectPath ?? null,
          ],
        );
        await client.query("COMMIT");
        return { created: true };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async claimDueReminders(now: string): Promise<string[]> {
      await ensureSchema();
      const result = await getPool().query<{ id: string }>(
        `UPDATE interviews SET reminder_sent_at = $1
         WHERE reminder_sent_at IS NULL
           AND status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at > $1
           AND scheduled_at <= $1 + interval '30 minutes'
         RETURNING id`,
        [now],
      );
      return result.rows.map((row) => row.id);
    },

    async get(id: string): Promise<InterviewRoom | null> {
      await ensureSchema();
      const result = await getPool().query<InterviewRow>(
        `SELECT ${ROOM_COLUMNS} FROM interviews WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToRoom(row) : null;
    },

    async list(filter?: DashboardListFilter): Promise<InterviewRoom[]> {
      await ensureSchema();

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter?.email) {
        params.push(`%${filter.email.trim()}%`);
        conditions.push(`candidate_email ILIKE $${params.length}`);
      }
      if (filter?.status && filter.status.length > 0) {
        params.push(filter.status);
        conditions.push(`status = ANY($${params.length})`);
      }

      let sql = `SELECT ${ROOM_COLUMNS} FROM interviews`;
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
      sql += " ORDER BY created_at DESC";
      if (filter?.limit && Number.isFinite(filter.limit) && filter.limit > 0) {
        params.push(Math.floor(filter.limit));
        sql += ` LIMIT $${params.length}`;
        if (filter.offset && Number.isFinite(filter.offset) && filter.offset > 0) {
          params.push(Math.floor(filter.offset));
          sql += ` OFFSET $${params.length}`;
        }
      }

      const result = await getPool().query<InterviewRow>(sql, params);
      return result.rows.map(rowToRoom);
    },

    async appendTurns(roomId: string, turns: readonly InterviewTurnInput[]): Promise<void> {
      if (turns.length === 0) return;
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        // One writer per interview (its agent job), serialized by this lock so
        // sequence numbers stay gapless and ordered across batches.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`turns:${roomId}`]);
        const next = await client.query<{ next: number }>(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM interview_turns WHERE room_id = $1",
          [roomId],
        );
        let seq = next.rows[0].next;
        for (const turn of turns) {
          await client.query(
            `INSERT INTO interview_turns
               (room_id, seq, speaker, text, started_at, ended_at, response_latency_ms,
                interrupted, phase, competency_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              roomId,
              seq,
              turn.speaker,
              turn.text,
              turn.startedAt,
              turn.endedAt,
              turn.responseLatencyMs,
              turn.interrupted,
              turn.phase,
              turn.competencyId,
            ],
          );
          seq += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async getTurns(roomId: string): Promise<InterviewTurn[]> {
      await ensureSchema();
      const result = await getPool().query<TurnRow>(
        `SELECT room_id, seq, speaker, text, started_at, ended_at, response_latency_ms,
                interrupted, phase, competency_id
         FROM interview_turns WHERE room_id = $1 ORDER BY seq ASC`,
        [roomId],
      );
      return result.rows.map(turnRowToTurn);
    },

    async appendEvents(roomId: string, events: readonly InterviewEventInput[]): Promise<void> {
      if (events.length === 0) return;
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`events:${roomId}`]);
        const next = await client.query<{ next: number }>(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM interview_events WHERE room_id = $1",
          [roomId],
        );
        let seq = next.rows[0].next;
        for (const event of events) {
          await client.query(
            "INSERT INTO interview_events (room_id, seq, type, at, data) VALUES ($1, $2, $3, $4, $5)",
            [roomId, seq, event.type, event.at, JSON.stringify(event.data)],
          );
          seq += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async getEvents(roomId: string): Promise<InterviewEvent[]> {
      await ensureSchema();
      const result = await getPool().query<{
        room_id: string;
        seq: number;
        type: string;
        at: Date;
        data: Record<string, unknown> | null;
      }>(
        "SELECT room_id, seq, type, at, data FROM interview_events WHERE room_id = $1 ORDER BY seq ASC",
        [roomId],
      );
      return result.rows.map((row) => ({
        roomId: row.room_id,
        seq: row.seq,
        type: row.type,
        at: row.at.toISOString(),
        data: row.data ?? {},
      }));
    },

    async saveScorecard(scorecard: Scorecard): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO scorecards (room_id, scorecard, generated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (room_id) DO UPDATE SET
           scorecard = EXCLUDED.scorecard,
           generated_at = now()`,
        [scorecard.roomId, JSON.stringify(scorecard)],
      );
    },

    async getScorecard(roomId: string): Promise<Scorecard | null> {
      await ensureSchema();
      const result = await getPool().query<{ scorecard: Scorecard }>(
        "SELECT scorecard FROM scorecards WHERE room_id = $1",
        [roomId],
      );
      return result.rows[0]?.scorecard ?? null;
    },

    async getScorecardSummaries(
      roomIds: readonly string[],
    ): Promise<Map<string, ScorecardSummary>> {
      const result = new Map<string, ScorecardSummary>();
      if (roomIds.length === 0) return result;

      await ensureSchema();
      const query = await getPool().query<{
        room_id: string;
        overall: number | null;
        suggestion: string | null;
        review: boolean | null;
        factors: ScorecardSummary["overall"];
      }>(
        `SELECT room_id,
                (scorecard ->> 'overallScore')::float AS overall,
                scorecard ->> 'suggestion' AS suggestion,
                (scorecard ->> 'needsHumanReview')::boolean AS review,
                scorecard -> 'overall' AS factors
         FROM scorecards
         WHERE room_id = ANY($1)`,
        [[...roomIds]],
      );

      for (const row of query.rows) {
        result.set(row.room_id, {
          overallScore: row.overall,
          suggestion: (row.suggestion ?? "insufficient") as ScorecardSummary["suggestion"],
          needsHumanReview: row.review ?? false,
          overall: row.factors ?? null,
        });
      }
      return result;
    },
  };
}

interface TurnRow {
  room_id: string;
  seq: number;
  speaker: string;
  text: string;
  started_at: Date | null;
  ended_at: Date | null;
  response_latency_ms: number | null;
  interrupted: boolean | null;
  phase: string | null;
  competency_id: string | null;
}

function turnRowToTurn(row: TurnRow): InterviewTurn {
  return {
    roomId: row.room_id,
    seq: row.seq,
    speaker: row.speaker === "candidate" ? "candidate" : "interviewer",
    text: row.text,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    responseLatencyMs: row.response_latency_ms,
    interrupted: row.interrupted ?? false,
    phase: row.phase,
    competencyId: row.competency_id,
  };
}
