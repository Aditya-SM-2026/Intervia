import "server-only";
import type { InterviewRepository, InterviewRoom } from "@/lib/interviews/interview.types";

/**
 * In-memory interview room store (temporary until a database is configured).
 * The map is kept on globalThis so Next.js hot reload in development does not
 * wipe it on every module reload.
 */

interface InterviewStore {
  rooms: Map<string, InterviewRoom>;
}

const globalStore = globalThis as unknown as { __interviewStore?: InterviewStore };

function getStore(): InterviewStore {
  if (!globalStore.__interviewStore) {
    globalStore.__interviewStore = { rooms: new Map() };
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
  };
}