import "server-only";
import { Pool } from "pg";
import type {
  DashboardAnalytics,
  DashboardAwaitingItem,
  DashboardListFilter,
} from "@/lib/dashboard/dashboard.types";
import { getInterviewStore } from "./in-memory-interview-repository";

/**
 * Dashboard queries over the interviews + scorecards tables: filtered
 * listing, real-data analytics and transactional deletes. Postgres in
 * production, in-memory for zero-setup local development.
 */

export interface DashboardRow {
  room: {
    id: string;
    title: string;
    candidateName: string | null;
    candidateEmail: string | null;
    recruiterName: string | null;
    roleTitle: string | null;
    status: string;
    createdAt: string;
    completedAt: string | null;
  };
  hasScorecard: boolean;
}

const globalRefs = globalThis as unknown as {
  __dashboardPgPool?: Pool;
};

function getPool(): Pool {
  if (!globalRefs.__dashboardPgPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; cannot use the Postgres dashboard repository");
    }
    globalRefs.__dashboardPgPool = new Pool({ connectionString, max: 3 });
  }
  return globalRefs.__dashboardPgPool;
}

function buildWhere(filter: DashboardListFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.search) {
    params.push(`%${filter.search.trim()}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(candidate_name ILIKE ${p} OR candidate_email ILIKE ${p} OR role_title ILIKE ${p} OR recruiter_name ILIKE ${p} OR title ILIKE ${p})`,
    );
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filter.roleTitle && filter.roleTitle.trim() !== "") {
    params.push(filter.roleTitle.trim());
    const p = `$${params.length}`;
    conditions.push(`role_title ILIKE ${p}`);
  }
  if (filter.to) {
    params.push(filter.to);
    conditions.push(`created_at < $${params.length}`);
  }
  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function rowToDashboardRow(row: {
  id: string;
  title: string;
  candidate_name: string | null;
  candidate_email: string | null;
  recruiter_name: string | null;
  role_title: string | null;
  status: string;
  created_at: Date;
  completed_at: Date | null;
  has_scorecard: boolean;
}): DashboardRow {
  return {
    room: {
      id: row.id,
      title: row.title,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      recruiterName: row.recruiter_name,
      roleTitle: row.role_title,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    },
    hasScorecard: row.has_scorecard,
  };
}

const ROW_SELECT = `i.id, i.title, i.candidate_name, i.candidate_email, i.recruiter_name,
  i.role_title, i.status, i.created_at, i.completed_at,
  (s.room_id IS NOT NULL) AS has_scorecard`;

export interface DashboardRepository {
  list(filter: DashboardListFilter): Promise<{ rows: DashboardRow[]; total: number }>;
  getAnalytics(): Promise<DashboardAnalytics>;
  /** Deletes the given sessions and all their children; returns per-id failures. */
  deleteSessions(roomIds: readonly string[]): Promise<{ deleted: string[]; failed: { roomId: string; error: string }[] }>;
}

export function getPostgresDashboardRepository(): DashboardRepository {
  return {
    async list(filter: DashboardListFilter) {
      const { sql, params } = buildWhere(filter);
      const limit = filter.limit && filter.limit > 0 ? Math.floor(filter.limit) : 20;
      const offset = filter.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
      const dir = filter.sortDir === "asc" ? "ASC" : "DESC";
      const pool = getPool();
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT ${ROW_SELECT}
           FROM interviews i
           LEFT JOIN scorecards s ON s.room_id = i.id
           ${sql}
           ORDER BY i.created_at ${dir}, i.id ${dir}
           LIMIT ${limit} OFFSET ${offset}`,
          params,
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM interviews i ${sql}`,
          params,
        ),
      ]);
      return {
        rows: (rows.rows as unknown as Parameters<typeof rowToDashboardRow>[0][]).map(rowToDashboardRow),
        total: Number((count.rows[0] as { total: number }).total ?? 0),
      };
    },

    async getAnalytics(): Promise<DashboardAnalytics> {
      const pool = getPool();
      const now = new Date();
      const periodStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      const prevStart = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
      const seriesStart = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

      const totals = await pool.query(
        `SELECT
           COUNT(*)::int AS total,
           (COUNT(*) FILTER (WHERE s.room_id IS NOT NULL))::int AS ready,
           (COUNT(*) FILTER (WHERE i.status = 'completed' AND s.room_id IS NULL))::int AS awaiting
         FROM interviews i
         LEFT JOIN scorecards s ON s.room_id = i.id`,
      );
      const prev = await pool.query(
        `SELECT
           COUNT(*)::int AS total,
           (COUNT(*) FILTER (WHERE s.room_id IS NOT NULL))::int AS ready,
           (COUNT(*) FILTER (WHERE i.status = 'completed' AND s.room_id IS NULL))::int AS awaiting
         FROM interviews i
         LEFT JOIN scorecards s ON s.room_id = i.id
         WHERE i.created_at >= $1 AND i.created_at < $2`,
        [prevStart.toISOString(), periodStart.toISOString()],
      );
      const series = await pool.query(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           (COUNT(i.id))::int AS interviews,
           (COUNT(*) FILTER (WHERE s.room_id IS NOT NULL))::int AS reports
         FROM generate_series($1::date, CURRENT_DATE, interval '1 day') d(day)
         LEFT JOIN interviews i ON date_trunc('day', i.created_at) = d.day
         LEFT JOIN scorecards s ON s.room_id = i.id
         GROUP BY d.day ORDER BY d.day`,
        [seriesStart.toISOString().slice(0, 10)],
      );
      const awaiting = await pool.query(
        `SELECT i.id, i.candidate_name, i.role_title,
           COALESCE(i.completed_at, i.created_at) AS at
         FROM interviews i
         LEFT JOIN scorecards s ON s.room_id = i.id
         WHERE i.status = 'completed' AND s.room_id IS NULL
         ORDER BY at DESC
         LIMIT 8`,
      );

      const t = totals.rows[0] as { total: number; ready: number; awaiting: number };
      const p = prev.rows[0] as { total: number; ready: number; awaiting: number };
      const rate = (r: { total: number; ready: number }) =>
        r.total > 0 ? Math.round((r.ready / r.total) * 100) : 0;
      const currentRate = rate(t);
      const prevRate = rate(p);
      return {
        total: Number(t.total),
        reportsReady: Number(t.ready),
        awaitingAnalysis: Number(t.awaiting),
        completionRate: currentRate,
        trends: {
          total: p.total > 0 ? pct(Number(p.total), Number(t.total)) : null,
          reportsReady: p.ready > 0 ? pct(Number(p.ready), Number(t.ready)) : null,
          awaitingAnalysis: p.awaiting > 0 ? pct(Number(p.awaiting), Number(t.awaiting)) : null,
          completionRate:
            p.total > 0 && prevRate !== currentRate
              ? Math.round(currentRate - prevRate)
              : null,
        },
        series: (series.rows as { date: string; interviews: number; reports: number }[]).map((row) => ({
          date: row.date,
          interviews: Number(row.interviews),
          reports: Number(row.reports),
        })),
        awaitingRecent: (awaiting.rows as {
          id: string;
          candidate_name: string | null;
          role_title: string | null;
          at: Date;
        }[]).map((row) => ({
          roomId: row.id,
          candidateName: row.candidate_name,
          roleTitle: row.role_title,
          at: row.at.toISOString(),
        })),
      };
    },

    async deleteSessions(roomIds) {
      const pool = getPool();
      const deleted: string[] = [];
      const failed: { roomId: string; error: string }[] = [];
      for (const roomId of roomIds) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM interview_turns WHERE room_id = $1", [roomId]);
          await client.query("DELETE FROM interview_events WHERE room_id = $1", [roomId]);
          await client.query("DELETE FROM scorecards WHERE room_id = $1", [roomId]);
          const result = await client.query("DELETE FROM interviews WHERE id = $1", [roomId]);
          await client.query("COMMIT");
          if ((result.rowCount ?? 0) === 0) {
            failed.push({ roomId, error: "Interview not found (may already be deleted)" });
          } else {
            deleted.push(roomId);
          }
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          failed.push({
            roomId,
            error: error instanceof Error ? "Database error while deleting" : "Unknown error",
          });
        } finally {
          client.release();
        }
      }
      return { deleted, failed };
    },
  };
}

function pct(previous: number, current: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

function matchesFilter(
  filter: DashboardListFilter,
  room: {
    candidateName: string | null;
    candidateEmail: string | null;
    recruiterName: string | null;
    roleTitle: string | null;
    title: string;
    status: string;
    createdAt: string;
  },
): boolean {
  const search = filter.search?.trim().toLowerCase();
  if (search) {
    const haystack = [room.candidateName, room.candidateEmail, room.recruiterName, room.roleTitle, room.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (filter.status && room.status !== filter.status) return false;
  if (filter.from && room.createdAt < filter.from) return false;
  if (filter.to && room.createdAt >= filter.to) return false;
  return true;
}

export function getInMemoryDashboardRepository(): DashboardRepository {
  return {
    async list(filter: DashboardListFilter) {
      const store = getInterviewStore();
      const all = [...store.rooms.values()]
        .filter((room) => matchesFilter(filter, room))
        .sort((a, b) => {
          const dir = filter.sortDir === "asc" ? 1 : -1;
          return dir * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        });
      const limit = filter.limit && filter.limit > 0 ? Math.floor(filter.limit) : 20;
      const offset = filter.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
      return {
        rows: all.slice(offset, offset + limit).map((room) => ({
          room: {
            id: room.id,
            title: room.title,
            candidateName: room.candidateName,
            candidateEmail: room.candidateEmail,
            recruiterName: room.recruiterName,
            roleTitle: room.roleTitle,
            status: room.status,
            createdAt: room.createdAt,
            completedAt: room.completedAt,
          },
          hasScorecard: store.scorecards.has(room.id),
        })),
        total: all.length,
      };
    },

    async getAnalytics(): Promise<DashboardAnalytics> {
      const store = getInterviewStore();
      const now = Date.now();
      const periodStart = now - 30 * 24 * 3600 * 1000;
      const prevStart = now - 60 * 24 * 3600 * 1000;
      const rooms = [...store.rooms.values()];
      const countWhere = (test: (room: { createdAt: string; status: string; id: string }) => boolean) => {
        const subset = rooms.filter(test);
        return {
          total: subset.length,
          ready: subset.filter((room) => store.scorecards.has(room.id)).length,
          awaiting: subset.filter((room) => room.status === "completed" && !store.scorecards.has(room.id)).length,
        };
      };
      const t = countWhere(() => true);
      const p = countWhere((room) => room.createdAt >= new Date(prevStart).toISOString() && room.createdAt < new Date(periodStart).toISOString());
      const rate = (r: { total: number; ready: number }) => (r.total > 0 ? Math.round((r.ready / r.total) * 100) : 0);
      const series: DashboardAnalytics["series"] = [];
      for (let day = 13; day >= 0; day -= 1) {
        const dayStart = new Date(now - day * 24 * 3600 * 1000);
        const key = dayStart.toISOString().slice(0, 10);
        const dayRooms = rooms.filter((room) => room.createdAt.slice(0, 10) === key);
        series.push({
          date: key,
          interviews: dayRooms.length,
          reports: dayRooms.filter((room) => store.scorecards.has(room.id)).length,
        });
      }
      const awaitingRecent: DashboardAwaitingItem[] = rooms
        .filter((room) => room.status === "completed" && !store.scorecards.has(room.id))
        .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
        .slice(0, 8)
        .map((room) => ({
          roomId: room.id,
          candidateName: room.candidateName,
          roleTitle: room.roleTitle,
          at: room.completedAt ?? room.createdAt,
        }));
      return {
        total: t.total,
        reportsReady: t.ready,
        awaitingAnalysis: t.awaiting,
        completionRate: rate(t),
        trends: {
          total: p.total > 0 ? pct(p.total, t.total) : null,
          reportsReady: p.ready > 0 ? pct(p.ready, t.ready) : null,
          awaitingAnalysis: p.awaiting > 0 ? pct(p.awaiting, t.awaiting) : null,
          completionRate: p.total > 0 && rate(p) !== rate(t) ? rate(t) - rate(p) : null,
        },
        series,
        awaitingRecent,
      };
    },

    async deleteSessions(roomIds) {
      const store = getInterviewStore();
      const deleted: string[] = [];
      const failed: { roomId: string; error: string }[] = [];
      for (const roomId of roomIds) {
        if (!store.rooms.has(roomId)) {
          failed.push({ roomId, error: "Interview not found (may already be deleted)" });
          continue;
        }
        store.rooms.delete(roomId);
        store.turns.delete(roomId);
        store.events.delete(roomId);
        store.scorecards.delete(roomId);
        deleted.push(roomId);
      }
      return { deleted, failed };
    },
  };
}

export function getDashboardRepository(): DashboardRepository {
  if (process.env.DATABASE_URL?.trim()) {
    return getPostgresDashboardRepository();
  }
  return getInMemoryDashboardRepository();
}