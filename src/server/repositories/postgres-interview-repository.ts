import "server-only";
import { Pool } from "pg";
import type {
  DashboardAnalytics,
  DashboardListFilter,
  DifficultyLevel,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
  InterviewTurn,
  InterviewTurnInput,
} from "@/lib/interviews/interview.types";
import type {
  InterviewReport,
  ReportIntegritySummary,
} from "@/lib/interviews/report.types";
import {
  parseStoredReport,
  reportIntegritySchema,
} from "@/lib/interviews/report.validation";

/**
 * Postgres-backed interview session store (Cloud SQL in production).
 * The schema is bootstrapped idempotently on first use so a fresh database
 * needs no separate migration step.
 *
 * Ownership: this repository WRITES interview rows (its own columns only —
 * columns owned by other workstreams are never overwritten) and the
 * dashboard-owned `reports` table. Sessions' pipeline fields and transcript
 * turns are READ-ONLY here: they are written by the pre-interview pipeline,
 * so reads are defensive (missing tables/columns degrade to empty/undefined,
 * never errors).
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
CREATE TABLE IF NOT EXISTS reports (
  room_id TEXT PRIMARY KEY,
  report JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TABLE IF EXISTS interview_transcripts;
DROP TABLE IF EXISTS interview_reports;
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

/**
 * Sessions whose analysis can meaningfully be awaited: the conversation
 * finished (completed) or the join window passed without enough content.
 * Shared by the analytics and awaiting-list queries so both define
 * "awaiting analysis" identically.
 */
const AWAITING_SQL = `(i.status = 'completed' OR (i.expires_at IS NOT NULL AND i.expires_at < now() AND i.status IN ('scheduled','waiting','active')))`;

/** Display-status semantics: expired is derived, never stored. */
function buildListWhere(filter?: DashboardListFilter): { where: string | null; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.email) {
    params.push(`%${filter.email.trim()}%`);
    conditions.push(`candidate_email ILIKE $${params.length}`);
  }
  if (filter?.search && filter.search.trim() !== "") {
    params.push(`%${filter.search.trim()}%`);
    const n = params.length;
    conditions.push(
      `(candidate_name ILIKE $${n} OR candidate_email ILIKE $${n} OR role_title ILIKE $${n} OR recruiter_name ILIKE $${n} OR title ILIKE $${n})`,
    );
  }
  if (filter?.status) {
    if (filter.status === "expired") {
      conditions.push(`(expires_at IS NOT NULL AND expires_at < now() AND status IN ('scheduled','waiting','active'))`);
    } else if (filter.status === "scheduled" || filter.status === "waiting" || filter.status === "active") {
      params.push(filter.status);
      conditions.push(`status = $${params.length} AND (expires_at IS NULL OR expires_at >= now())`);
    } else {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
  }
  if (filter?.reportState === "ready") {
    conditions.push("EXISTS (SELECT 1 FROM reports r WHERE r.room_id = interviews.id)");
  } else if (filter?.reportState === "processing") {
    // Actively underway, or completed with enough answers to analyze (same
    // threshold as report.service MIN_CANDIDATE_TURNS) but not generated yet.
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM reports r WHERE r.room_id = interviews.id) AND (status = 'active' OR (status = 'completed' AND (SELECT COUNT(*) FROM interview_turns t WHERE t.room_id = interviews.id AND t.speaker = 'candidate') >= 5))",
    );
  } else if (filter?.reportState === "not-started") {
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM reports r WHERE r.room_id = interviews.id) AND NOT (status = 'active' OR (status = 'completed' AND (SELECT COUNT(*) FROM interview_turns t WHERE t.room_id = interviews.id AND t.speaker = 'candidate') >= 5))",
    );
  }
  if (filter?.from) {
    params.push(filter.from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filter?.to) {
    params.push(filter.to);
    conditions.push(`created_at < $${params.length}`);
  }

  return { where: conditions.length > 0 ? conditions.join(" AND ") : null, params };
}

function sortDir(filter?: DashboardListFilter): string {
  return filter?.sortDir === "asc" ? "ASC" : "DESC";
}

function positiveOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
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

const integritySummarySchema = reportIntegritySchema.pick({
  probability: true,
  level: true,
});

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

    async list(filter?: DashboardListFilter): Promise<InterviewRoom[]> {
      await ensureSchema();
      const { where, params } = buildListWhere(filter);
      let sql = `SELECT id, title, candidate_name, status, created_at, expires_at,
          recruiter_name, candidate_email, role_title, jd_source, jd_text,
          resume_file_name, resume_text, resume_unreadable, consent_given_at, completed_at
        FROM interviews`;
      if (where) sql += ` WHERE ${where}`;
      sql += ` ORDER BY created_at ${sortDir(filter)}`;
      const limit = positiveOrUndefined(filter?.limit);
      if (limit !== undefined) {
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
        const offset = positiveOrUndefined(filter?.offset);
        if (offset !== undefined) {
          params.push(offset);
          sql += ` OFFSET $${params.length}`;
        }
      }
      const result = await getPool().query<InterviewRow>(sql, params);
      return result.rows.map(rowToRoom);
    },

    async count(filter?: DashboardListFilter): Promise<number> {
      await ensureSchema();
      const { where, params } = buildListWhere(filter);
      const sql = `SELECT COUNT(*)::int AS total FROM interviews${where ? ` WHERE ${where}` : ""}`;
      const result = await getPool().query<{ total: number }>(sql, params);
      return result.rows[0]?.total ?? 0;
    },

    async getCandidateTurnCounts(roomIds: readonly string[]): Promise<Map<string, number>> {
      if (roomIds.length === 0) return new Map();
      await ensureSchema();
      const result = await getPool().query<{ room_id: string; n: number }>(
        `SELECT room_id, COUNT(*)::int AS n FROM interview_turns
         WHERE room_id = ANY($1::text[]) AND speaker = 'candidate'
         GROUP BY room_id`,
        [[...roomIds]],
      );
      return new Map(result.rows.map((row) => [row.room_id, row.n]));
    },

    async getDashboardAnalytics(): Promise<DashboardAnalytics> {
      await ensureSchema();
      // One pass over interviews LEFT JOIN reports: every card, trend window
      // and the awaiting-analysis definition come from real rows. Trends and
      // rates are turned into percentages only where the denominator is a
      // real previous-period count; the UI never invents a delta.
      const cards = await getPool().query<{
        total: number;
        ready: number;
        awaiting: number;
        total_curr: number;
        total_prev: number;
        ready_curr: number;
        ready_prev: number;
        awaiting_curr: number;
        awaiting_prev: number;
      }>(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(r.room_id)::int AS ready,
          (COUNT(*) FILTER (WHERE r.room_id IS NULL AND ${AWAITING_SQL}))::int AS awaiting,
          (COUNT(*) FILTER (WHERE i.created_at >= now() - interval '30 days'))::int AS total_curr,
          (COUNT(*) FILTER (WHERE i.created_at >= now() - interval '60 days' AND i.created_at < now() - interval '30 days'))::int AS total_prev,
          (COUNT(*) FILTER (WHERE r.room_id IS NOT NULL AND i.created_at >= now() - interval '30 days'))::int AS ready_curr,
          (COUNT(*) FILTER (WHERE r.room_id IS NOT NULL AND i.created_at >= now() - interval '60 days' AND i.created_at < now() - interval '30 days'))::int AS ready_prev,
          (COUNT(*) FILTER (WHERE r.room_id IS NULL AND ${AWAITING_SQL} AND i.created_at >= now() - interval '30 days'))::int AS awaiting_curr,
          (COUNT(*) FILTER (WHERE r.room_id IS NULL AND ${AWAITING_SQL} AND i.created_at >= now() - interval '60 days' AND i.created_at < now() - interval '30 days'))::int AS awaiting_prev
        FROM interviews i
        LEFT JOIN reports r ON r.room_id = i.id`,
      );

      const series = await getPool().query<{ day: Date; interviews: number; reports: number }>(
        `SELECT d::date AS day,
          COUNT(i.id)::int AS interviews,
          (SELECT COUNT(*)::int FROM reports r JOIN interviews i2 ON i2.id = r.room_id
            WHERE r.generated_at::date = d::date) AS reports
        FROM generate_series(now()::date - interval '13 days', now()::date, interval '1 day') d
        LEFT JOIN interviews i ON i.created_at::date = d::date
        GROUP BY d ORDER BY d`,
      );

      const awaitingRecent = await getPool().query<{
        id: string;
        candidate_name: string | null;
        role_title: string | null;
        at: Date;
      }>(
        `SELECT i.id, i.candidate_name, i.role_title,
          COALESCE(i.completed_at, i.created_at) AS at
        FROM interviews i
        WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.room_id = i.id)
          AND ${AWAITING_SQL}
        ORDER BY at DESC
        LIMIT 8`,
      );

      const c = cards.rows[0];
      const row = c ?? {
        total: 0, ready: 0, awaiting: 0,
        total_curr: 0, total_prev: 0, ready_curr: 0, ready_prev: 0,
        awaiting_curr: 0, awaiting_prev: 0,
      };
      const rate = (ready: number, total: number) => (total > 0 ? Math.round((ready / total) * 100) : 0);
      const pctChange = (curr: number, prev: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null);
      return {
        total: row.total,
        reportsReady: row.ready,
        awaitingAnalysis: row.awaiting,
        completionRate: rate(row.ready, row.total),
        trends: {
          total: pctChange(row.total_curr, row.total_prev),
          reportsReady: pctChange(row.ready_curr, row.ready_prev),
          awaitingAnalysis: pctChange(row.awaiting_curr, row.awaiting_prev),
          completionRate:
            row.total_prev > 0
              ? rate(row.ready_curr, row.total_curr) - rate(row.ready_prev, row.total_prev)
              : null,
        },
        series: series.rows.map((r) => ({
          date: r.day.toISOString().slice(0, 10),
          interviews: r.interviews,
          reports: r.reports,
        })),
        awaitingRecent: awaitingRecent.rows.map((r) => ({
          roomId: r.id,
          candidateName: r.candidate_name,
          roleTitle: r.role_title,
          at: r.at.toISOString(),
        })),
      };
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

    async deleteInterview(roomId: string): Promise<boolean> {
      await ensureSchema();
      // One transaction so a session is never left half-deleted (turns gone,
      // row alive, or vice versa).
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM interview_turns WHERE room_id = $1", [roomId]);
        await client.query("DELETE FROM reports WHERE room_id = $1", [roomId]);
        const deleted = await client.query("DELETE FROM interviews WHERE id = $1", [roomId]);
        await client.query("COMMIT");
        return (deleted.rowCount ?? 0) > 0;
      } catch (cause) {
        await client.query("ROLLBACK");
        throw cause;
      } finally {
        client.release();
      }
    },

    async saveReport(report: InterviewReport): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO reports (room_id, report, generated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (room_id) DO UPDATE SET
           report = EXCLUDED.report,
           generated_at = now()`,
        [report.roomId, JSON.stringify(report)],
      );
    },

    async getReport(roomId: string): Promise<InterviewReport | null> {
      await ensureSchema();
      const result = await getPool().query<{ report: unknown }>(
        "SELECT report FROM reports WHERE room_id = $1",
        [roomId],
      );
      const row = result.rows[0];
      return row ? parseStoredReport(row.report) : null;
    },

    async getReportIntegrity(
      roomIds: readonly string[],
    ): Promise<Map<string, ReportIntegritySummary>> {
      const result = new Map<string, ReportIntegritySummary>();
      if (roomIds.length === 0) return result;

      await ensureSchema();
      const query = await getPool().query<{ room_id: string; integrity: unknown }>(
        `SELECT room_id, report -> 'integrity' AS integrity
         FROM reports
         WHERE room_id = ANY($1)`,
        [[...roomIds]],
      );

      for (const row of query.rows) {
        const parsed = integritySummarySchema.safeParse(row.integrity);
        if (parsed.success) {
          result.set(row.room_id, parsed.data);
        }
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