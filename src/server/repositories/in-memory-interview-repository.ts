import "server-only";
import type {
  DashboardAnalytics,
  DashboardListFilter,
  InterviewRepository,
  InterviewRoom,
  InterviewTurn,
  InterviewTurnInput,
} from "@/lib/interviews/interview.types";
import type {
  InterviewReport,
  ReportIntegritySummary,
} from "@/lib/interviews/report.types";

/**
 * In-memory interview session store (temporary until a database is
 * configured). The object is kept on globalThis so Next.js hot reload in
 * development does not wipe it on every module reload.
 *
 * Ownership: rooms and reports are written here; transcript turns are
 * written by the interview pipeline (in-memory dev mirror) and only read.
 */

/** Display-status semantics mirrored from the Postgres implementation. */
function isExpiredStatus(room: InterviewRoom): boolean {
  return (
    room.expiresAt !== null &&
    Date.parse(room.expiresAt) < Date.now() &&
    (room.status === "scheduled" || room.status === "waiting" || room.status === "active")
  );
}

function matchesFilter(room: InterviewRoom, filter?: DashboardListFilter): boolean {
  if (filter?.email) {
    const email = filter.email.trim().toLowerCase();
    if (!(room.candidateEmail ?? "").toLowerCase().includes(email)) return false;
  }
  if (filter?.search && filter.search.trim() !== "") {
    const q = filter.search.trim().toLowerCase();
    const haystack = [room.candidateName, room.candidateEmail, room.roleTitle, room.recruiterName, room.title]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filter?.status) {
    if (filter.status === "expired") {
      if (!isExpiredStatus(room)) return false;
    } else if (
      (filter.status === "scheduled" || filter.status === "waiting" || filter.status === "active") &&
      isExpiredStatus(room)
    ) {
      return false;
    } else if (room.status !== filter.status) {
      return false;
    }
  }
  if (filter?.reportState) {
    const ready = storeHasReport(room.id);
    const candidateTurns = (getStore().turns.get(room.id) ?? []).filter(
      (turn) => turn.speaker === "candidate",
    ).length;
    const analyzable =
      candidateTurns >= 5 && room.status === "completed";
    if (filter.reportState === "ready" && !ready) return false;
    if (filter.reportState === "processing" && (ready || (!analyzable && room.status !== "active"))) {
      return false;
    }
    if (filter.reportState === "not-started" && (ready || analyzable || room.status === "active")) {
      return false;
    }
  }
  if (filter?.from && Date.parse(room.createdAt) < Date.parse(filter.from)) return false;
  if (filter?.to && Date.parse(room.createdAt) >= Date.parse(filter.to)) return false;
  return true;
}

function storeHasReport(roomId: string): boolean {
  return getStore().reports.has(roomId);
}

interface InterviewStore {
  rooms: Map<string, InterviewRoom>;
  /** roomId -> { workerId, claimedAtMs } for exclusive agent claims. */
  claims: Map<string, { workerId: string; claimedAtMs: number }>;
/** roomId -> transcript turns in insertion order. */
  turns: Map<string, InterviewTurn[]>;
  /** roomId -> generated report (dashboard-owned). */
  reports: Map<string, InterviewReport>;
}

const globalStore = globalThis as unknown as { __interviewStore?: InterviewStore };

function getStore(): InterviewStore {
  if (!globalStore.__interviewStore) {
    globalStore.__interviewStore = {
      rooms: new Map(),
      claims: new Map(),
      turns: new Map(),
      reports: new Map(),
    };
  }
  return globalStore.__interviewStore;
}

export function getInMemoryInterviewRepository(): InterviewRepository {
  const store = getStore();

  return {
    async save(room: InterviewRoom): Promise<void> {
      store.rooms.set(room.id, room);
    },

    async get(id: string): Promise<InterviewRoom | null> {
      return store.rooms.get(id) ?? null;
    },

    async list(filter?: DashboardListFilter): Promise<InterviewRoom[]> {
      let rooms = [...store.rooms.values()].filter((room) => matchesFilter(room, filter));
      rooms.sort((a, b) => {
        const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        return filter?.sortDir === "asc" ? delta : -delta;
      });
      const offset = filter?.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
      if (offset > 0) rooms = rooms.slice(offset);
      const limit = filter?.limit && filter.limit > 0 ? Math.floor(filter.limit) : undefined;
      if (limit !== undefined) rooms = rooms.slice(0, limit);
      return rooms;
    },

    async count(filter?: DashboardListFilter): Promise<number> {
      return [...store.rooms.values()].filter((room) => matchesFilter(room, filter)).length;
    },

    async getCandidateTurnCounts(roomIds: readonly string[]): Promise<Map<string, number>> {
      const counts = new Map<string, number>();
      for (const roomId of roomIds) {
        counts.set(
          roomId,
          (store.turns.get(roomId) ?? []).filter((turn) => turn.speaker === "candidate").length,
        );
      }
      return counts;
    },

    async getDashboardAnalytics(): Promise<DashboardAnalytics> {
      const rooms = [...store.rooms.values()];
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      let reportsReady = 0;
      let awaitingAnalysis = 0;
      let totalCurr = 0;
      let totalPrev = 0;
      let readyCurr = 0;
      let readyPrev = 0;
      let awaitingCurr = 0;
      let awaitingPrev = 0;

      for (const room of rooms) {
        const ready = storeHasReport(room.id);
        const awaiting = !ready && (room.status === "completed" || isExpiredStatus(room));
        const created = Date.parse(room.createdAt);
        if (ready) reportsReady++;
        if (awaiting) awaitingAnalysis++;
        if (created >= now - thirtyDays) {
          totalCurr++;
          if (ready) readyCurr++;
          if (awaiting) awaitingCurr++;
        } else if (created >= now - 2 * thirtyDays) {
          totalPrev++;
          if (ready) readyPrev++;
          if (awaiting) awaitingPrev++;
        }
      }

      const rate = (ready: number, total: number) => (total > 0 ? Math.round((ready / total) * 100) : 0);
      const pctChange = (curr: number, prev: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null);

      const series: DashboardAnalytics["series"] = [];
      for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
        const day = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
        const key = day.toISOString().slice(0, 10);
        const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
        series.push({
          date: key,
          interviews: rooms.filter((room) => {
            const created = Date.parse(room.createdAt);
            return created >= Date.parse(key) && created < next.getTime();
          }).length,
          reports: [...store.reports.values()].filter((report) => {
            const generated = Date.parse(report.generatedAt);
            return generated >= Date.parse(key) && generated < next.getTime() && store.rooms.has(report.roomId);
          }).length,
        });
      }

      const awaitingRecent = rooms
        .filter((room) => !storeHasReport(room.id) && (room.status === "completed" || isExpiredStatus(room)))
        .sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt))
        .slice(0, 8)
        .map((room) => ({
          roomId: room.id,
          candidateName: room.candidateName,
          roleTitle: room.roleTitle,
          at: room.completedAt ?? room.createdAt,
        }));

      return {
        total: rooms.length,
        reportsReady,
        awaitingAnalysis,
        completionRate: rate(reportsReady, rooms.length),
        trends: {
          total: pctChange(totalCurr, totalPrev),
          reportsReady: pctChange(readyCurr, readyPrev),
          awaitingAnalysis: pctChange(awaitingCurr, awaitingPrev),
          completionRate: totalPrev > 0 ? rate(readyCurr, totalCurr) - rate(readyPrev, totalPrev) : null,
        },
        series,
        awaitingRecent,
      };
    },

    async claimForAgent(roomId: string, workerId: string, ttlSeconds: number): Promise<boolean> {
      // No rooms.has() guard: this store belongs to the worker process, which
      // never creates interview rows itself (they live in the web process or
      // the database). Any roomId may be claimed; TTLs keep it safe.
      const existing = store.claims.get(roomId);
      const fresh = existing && Date.now() - existing.claimedAtMs < ttlSeconds * 1000;
      if (fresh && existing.workerId !== workerId) return false;
      store.claims.set(roomId, { workerId, claimedAtMs: Date.now() });
      return true;
    },

    async releaseAgentClaim(roomId: string, workerId: string): Promise<void> {
      const existing = store.claims.get(roomId);
      if (existing && existing.workerId === workerId) {
        store.claims.delete(roomId);
      }
    },

async appendTurn(roomId: string, turn: InterviewTurnInput): Promise<void> {
      const list = store.turns.get(roomId) ?? [];
      const stored: InterviewTurn = { roomId, seq: list.length + 1, ...turn };
      list.push(stored);
      store.turns.set(roomId, list);
    },

    async getTurns(roomId: string): Promise<InterviewTurn[]> {
      return [...(store.turns.get(roomId) ?? [])];
    },

    async completeSession(roomId: string): Promise<void> {
      const room = store.rooms.get(roomId);
      if (!room || room.status === "completed" || room.status === "expired" || room.status === "cancelled") {
        return;
      }
      store.rooms.set(roomId, {
        ...room,
        status: "completed",
        completedAt: new Date().toISOString(),
      });
    },

    async deleteInterview(roomId: string): Promise<boolean> {
      const existed = store.rooms.delete(roomId);
      store.turns.delete(roomId);
      store.reports.delete(roomId);
      return existed;
    },

    async saveReport(report: InterviewReport): Promise<void> {
      store.reports.set(report.roomId, report);
    },

    async getReport(roomId: string): Promise<InterviewReport | null> {
      return store.reports.get(roomId) ?? null;
    },

    async getReportIntegrity(
      roomIds: readonly string[],
    ): Promise<Map<string, ReportIntegritySummary>> {
      const result = new Map<string, ReportIntegritySummary>();
      for (const roomId of roomIds) {
        const report = store.reports.get(roomId);
        if (report) {
          result.set(roomId, {
            probability: report.integrity.probability,
            level: report.integrity.level,
          });
        }
      }
      return result;
    },
  };
}