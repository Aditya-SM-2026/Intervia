import "server-only";
import type {
  InterviewRepository,
  InterviewRoom,
  InterviewTurn,
  InterviewTurnInput,
} from "@/lib/interviews/interview.types";

/**
 * In-memory interview room store (temporary until a database is configured).
 * The map is kept on globalThis so Next.js hot reload in development does not
 * wipe it on every module reload.
 */

interface InterviewStore {
  rooms: Map<string, InterviewRoom>;
  /** roomId -> { workerId, claimedAtMs } for exclusive agent claims. */
  claims: Map<string, { workerId: string; claimedAtMs: number }>;
  /** roomId -> transcript turns in insertion order. */
  turns: Map<string, InterviewTurn[]>;
}

const globalStore = globalThis as unknown as { __interviewStore?: InterviewStore };

function getStore(): InterviewStore {
  if (!globalStore.__interviewStore) {
    globalStore.__interviewStore = {
      rooms: new Map(),
      claims: new Map(),
      turns: new Map(),
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
  };
}