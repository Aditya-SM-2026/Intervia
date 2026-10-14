import "server-only";
import type {
  DashboardListFilter,
  InterviewEvent,
  InterviewEventInput,
  InterviewRepository,
  InterviewRoom,
  InterviewTurn,
  InterviewTurnInput,
} from "@/lib/interviews/interview.types";
import type { Scorecard, ScorecardSummary } from "@/lib/interviews/scorecard.types";

/**
 * In-memory store for zero-setup local development. Kept on globalThis so
 * Next.js hot reload does not wipe it. The agent worker never touches this
 * directly: it reads and writes through /api/agent/*, so a local interview
 * works end to end without a database. Data is lost when the dev server stops.
 */

interface InterviewStore {
  rooms: Map<string, InterviewRoom>;
  turns: Map<string, InterviewTurn[]>;
  events: Map<string, InterviewEvent[]>;
  scorecards: Map<string, Scorecard>;
}

const globalStore = globalThis as unknown as { __interviewStoreV2?: InterviewStore };

function getStore(): InterviewStore {
  if (!globalStore.__interviewStoreV2) {
    globalStore.__interviewStoreV2 = {
      rooms: new Map(),
      turns: new Map(),
      events: new Map(),
      scorecards: new Map(),
    };
  }
  return globalStore.__interviewStoreV2;
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

    async claimDueReminders(now: string): Promise<string[]> {
      const nowMs = Date.parse(now);
      const claimed: string[] = [];
      for (const room of store.rooms.values()) {
        if (room.reminderSentAt) continue;
        if (room.status !== "scheduled" || !room.scheduledAt) continue;
        const due = Date.parse(room.scheduledAt);
        if (Number.isNaN(due) || due <= nowMs || due > nowMs + 30 * 60_000) continue;
        room.reminderSentAt = now;
        claimed.push(room.id);
      }
      return claimed;
    },

    async list(filter?: DashboardListFilter): Promise<InterviewRoom[]> {
      let rooms = [...store.rooms.values()];
      const email = filter?.email?.trim().toLowerCase();
      if (email) {
        rooms = rooms.filter(
          (room) =>
            typeof room.candidateEmail === "string" &&
            room.candidateEmail.toLowerCase().includes(email),
        );
      }
      rooms.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const offset = filter?.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
      if (offset > 0) rooms = rooms.slice(offset);
      const limit = filter?.limit && filter.limit > 0 ? Math.floor(filter.limit) : undefined;
      if (limit !== undefined) rooms = rooms.slice(0, limit);
      return rooms;
    },

    async appendTurns(roomId: string, turns: readonly InterviewTurnInput[]): Promise<void> {
      const list = store.turns.get(roomId) ?? [];
      for (const turn of turns) {
        list.push({ roomId, seq: list.length + 1, ...turn });
      }
      store.turns.set(roomId, list);
    },

    async getTurns(roomId: string): Promise<InterviewTurn[]> {
      return [...(store.turns.get(roomId) ?? [])];
    },

    async appendEvents(roomId: string, events: readonly InterviewEventInput[]): Promise<void> {
      const list = store.events.get(roomId) ?? [];
      for (const event of events) {
        list.push({ roomId, seq: list.length + 1, ...event });
      }
      store.events.set(roomId, list);
    },

    async getEvents(roomId: string): Promise<InterviewEvent[]> {
      return [...(store.events.get(roomId) ?? [])];
    },

    async saveScorecard(scorecard: Scorecard): Promise<void> {
      store.scorecards.set(scorecard.roomId, scorecard);
    },

    async getScorecard(roomId: string): Promise<Scorecard | null> {
      return store.scorecards.get(roomId) ?? null;
    },

    async getScorecardSummaries(
      roomIds: readonly string[],
    ): Promise<Map<string, ScorecardSummary>> {
      const result = new Map<string, ScorecardSummary>();
      for (const roomId of roomIds) {
        const scorecard = store.scorecards.get(roomId);
        if (scorecard) {
          result.set(roomId, {
            overallScore: scorecard.overallScore,
            suggestion: scorecard.suggestion,
            needsHumanReview: scorecard.needsHumanReview,
            overall: scorecard.overall ?? null,
          });
        }
      }
      return result;
    },
  };
}
