import "server-only";
import { randomUUID } from "node:crypto";
import type {
  AssistantExchangeInput,
  DashboardListFilter,
  InterviewEvent,
  InterviewEventInput,
  InterviewRepository,
  InterviewRoom,
  InterviewTurn,
  InterviewTurnInput,
} from "@/lib/interviews/interview.types";
import type {
  AssistantCandidateRef,
  AssistantConversation,
  AssistantMessage,
} from "@/lib/interviews/assistant.types";
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
  assistantConversations: Map<string, AssistantConversation>;
  assistantMessages: Map<string, AssistantMessage[]>;
}

const globalStore = globalThis as unknown as { __interviewStoreV2?: InterviewStore };

/**
 * Direct read access to the in-memory store, for other in-memory
 * repositories (roles) that must stay consistent without a second store.
 */
export function getInterviewStore(): InterviewStore {
  return getStore();
}

function getStore(): InterviewStore {
  if (!globalStore.__interviewStoreV2) {
    globalStore.__interviewStoreV2 = {
      rooms: new Map(),
      turns: new Map(),
      events: new Map(),
      scorecards: new Map(),
      assistantConversations: new Map(),
      assistantMessages: new Map(),
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

    async insertRoomAtomically(
      room: InterviewRoom,
      _duplicateKey: string,
    ): Promise<{ created: true } | { created: false; existing: InterviewRoom }> {
      const existing = [...store.rooms.values()].find(
        (candidate) =>
          candidate.candidateEmail === room.candidateEmail &&
          candidate.roleTitle?.toLowerCase() === room.roleTitle?.toLowerCase() &&
          candidate.status === "scheduled" &&
          candidate.completedAt === null &&
          candidate.scheduledAt === room.scheduledAt,
      );
      if (existing) return { created: false, existing };
      store.rooms.set(room.id, room);
      return { created: true };
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
      if (filter?.status && filter.status.length > 0) {
        const wanted = new Set(filter.status);
        rooms = rooms.filter((room) => wanted.has(room.status));
      }
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
            integrityLevel: scorecard.integrityCheck?.level ?? null,
          });
        }
      }
      return result;
    },

    async createAssistantConversation(roomId, title) {
      const now = new Date().toISOString();
      const conversation: AssistantConversation = {
        id: randomUUID(),
        roomId,
        title: title.slice(0, 120),
        createdAt: now,
        updatedAt: now,
      };
      store.assistantConversations.set(conversation.id, conversation);
      store.assistantMessages.set(conversation.id, []);
      return conversation;
    },

    async listAssistantConversations(roomId) {
      return [...store.assistantConversations.values()]
        .filter((conversation) => conversation.roomId === roomId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 40);
    },

    async getAssistantConversation(conversationId, roomId) {
      const conversation = store.assistantConversations.get(conversationId);
      return conversation && conversation.roomId === roomId ? conversation : null;
    },

    async getAssistantMessages(conversationId) {
      return [...(store.assistantMessages.get(conversationId) ?? [])];
    },

    async appendAssistantExchange(conversationId, exchange: AssistantExchangeInput) {
      const userTime = new Date();
      const assistantTime = new Date(userTime.getTime() + 1);
      const user: AssistantMessage = {
        id: randomUUID(),
        conversationId,
        role: "user",
        content: exchange.userContent,
        answer: null,
        scope: exchange.scope,
        referencedRoomIds: exchange.referencedRoomIds,
        model: null,
        costUsd: null,
        createdAt: userTime.toISOString(),
      };
      const assistant: AssistantMessage = {
        id: randomUUID(),
        conversationId,
        role: "assistant",
        content: exchange.assistantContent,
        answer: exchange.answer,
        scope: exchange.scope,
        referencedRoomIds: exchange.referencedRoomIds,
        model: exchange.model,
        costUsd: exchange.costUsd,
        createdAt: assistantTime.toISOString(),
      };
      const messages = store.assistantMessages.get(conversationId) ?? [];
      messages.push(user, assistant);
      store.assistantMessages.set(conversationId, messages);
      const conversation = store.assistantConversations.get(conversationId);
      if (conversation) {
        conversation.updatedAt = assistant.createdAt;
        store.assistantConversations.set(conversationId, conversation);
      }
      return [user, assistant];
    },

    async deleteAssistantConversation(conversationId, roomId) {
      const conversation = store.assistantConversations.get(conversationId);
      if (!conversation || conversation.roomId !== roomId) return false;
      store.assistantConversations.delete(conversationId);
      store.assistantMessages.delete(conversationId);
      return true;
    },

    async listAssistantCandidates(): Promise<AssistantCandidateRef[]> {
      const result: AssistantCandidateRef[] = [];
      for (const room of store.rooms.values()) {
        const scorecard = store.scorecards.get(room.id);
        const customScores: Record<string, number | null> = {};
        for (const parameter of scorecard?.customParameters ?? []) {
          customScores[parameter.skill] = parameter.score;
        }
        result.push({
          roomId: room.id,
          candidateName: room.candidateName,
          roleTitle: room.roleTitle,
          roleId: room.roleId,
          status: room.status,
          overall: scorecard?.overall?.score ?? null,
          answers: scorecard?.answerQuality ?? null,
          resume: scorecard?.resumeMatch?.score ?? null,
          authenticity: scorecard?.authenticity?.score ?? null,
          video: scorecard?.video?.score ?? null,
          customScores,
          decision: room.decision?.outcome ?? null,
          suggestion: scorecard?.suggestion ?? null,
        });
      }
      result.sort((a, b) => (a.candidateName ?? "").localeCompare(b.candidateName ?? ""));
      return result.slice(0, 1000);
    },
  };
}
