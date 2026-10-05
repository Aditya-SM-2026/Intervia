/** Lifecycle states for an interview room (status transitions land in Phase 2). */
export type InterviewStatus =
  | "scheduled"
  | "waiting"
  | "active"
  | "completed"
  | "expired"
  | "cancelled";

/** Who a participant is in the interview room. */
export type ParticipantRole = "candidate" | "interviewer" | "ai_agent";

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  /** ISO 8601 timestamp of when the participant joined, if they have. */
  joinedAt: string | null;
}

export interface InterviewRoom {
  /** Opaque, URL-safe identifier used in candidate links. */
  id: string;
  title: string;
  /** Optional display name for the candidate. Never used for auth. */
  candidateName: string | null;
  status: InterviewStatus;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp after which the link can no longer be joined. */
  expiresAt: string | null;
}

export interface CreateInterviewInput {
  title: string;
  candidateName?: string;
  /** Requested interview length in minutes. Optional. */
  durationMinutes?: number;
}

/** Uniform error body returned by the interview/room API endpoints. */
export interface InterviewApiError {
  error: {
    code:
      | "INVALID_INPUT"
      | "ROOM_NOT_FOUND"
      | "ROOM_EXPIRED"
      | "ROOM_UNAVAILABLE"
      | "SERVER_ERROR";
    message: string;
  };
}

/**
 * Storage boundary for interview rooms. Storage is deliberately isolated
 * behind this interface so the in-memory store can later be swapped for a
 * database without touching route handlers or services.
 */
export interface InterviewRepository {
  save(room: InterviewRoom): Promise<void>;
  get(id: string): Promise<InterviewRoom | null>;
}