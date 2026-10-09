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

/**
 * Interviewer personality: how hard the AI interviewer pushes. Each level has
 * its own prompt section (see buildSystemPrompt in the agent session).
 */
export type DifficultyLevel = "easy" | "medium" | "hard" | "extra-hard";

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  /** ISO 8601 timestamp of when the participant joined, if they have. */
  joinedAt: string | null;
}

/** Where the job description for a session came from. */
export interface JobDescription {
  source: "text" | "pdf";
  text: string;
}

/** Extracted resume information for a session (PDF uploads, text extracted server-side). */
export interface ResumeInfo {
  fileName: string;
  text: string;
  /** Set when the PDF could not be read; the interview then runs JD-only. */
  unreadable?: boolean;
}

/** Candidate consent captured at the email gate, before joining. */
export interface ConsentRecord {
  /** ISO 8601 timestamp of when consent was given. */
  givenAt: string;
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
  /** Session fields (see docs/PRE_INTERVIEW_PLAN.md). */
  recruiterName: string | null;
  /** The only email that may open this link; the join token is issued after it matches. */
  candidateEmail: string | null;
  roleTitle: string | null;
  /** Interviewer personality chosen by the recruiter (default: medium). */
  difficulty: DifficultyLevel;
  /** Interview length in minutes (5-10); enforced by the agent session. */
  durationMinutes: number;
  jobDescription: JobDescription | null;
  resume: ResumeInfo | null;
  consent: ConsentRecord | null;
  /** ISO 8601 timestamp set when the agent session ends. */
  completedAt: string | null;
}

export interface CreateInterviewInput {
  /** Display title; defaults to the role title when omitted. */
  title?: string;
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  /** Interview length in minutes (5-10). Drives agent pacing and enforcement. */
  durationMinutes: number;
  /** How hard the interviewer pushes (default: medium). */
  difficulty: DifficultyLevel;
  jobDescription: JobDescription | null;
  resume: ResumeInfo | null;
}

/** One transcript turn of a session, persisted incrementally by the agent. */
export interface InterviewTurn {
  roomId: string;
  /** 1-based order within the room. */
  seq: number;
  speaker: "interviewer" | "candidate";
  text: string;
  /** Interviewer turns: when the question was sent. */
  askedAt: string | null;
  /** Candidate turns: when the final answer arrived. */
  answeredAt: string | null;
  /** answeredAt - askedAt for candidate turns; an AI-usage signal. */
  latencyMs: number | null;
}

export interface InterviewTurnInput {
  speaker: "interviewer" | "candidate";
  text: string;
  askedAt: string | null;
  answeredAt: string | null;
  latencyMs: number | null;
}

/** Uniform error body returned by the interview/room API endpoints. */
export interface InterviewApiError {
  error: {
    code:
      | "INVALID_INPUT"
      | "ROOM_NOT_FOUND"
      | "ROOM_EXPIRED"
      | "ROOM_UNAVAILABLE"
      | "EMAIL_MISMATCH"
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
  /**
   * Exclusive claim so only one agent worker joins a room (several workers
   * poll the same rooms). Returns false when another worker holds a fresh
   * claim. Claims expire after ttlSeconds so a crashed worker's room is
   * recoverable.
   */
  claimForAgent(roomId: string, workerId: string, ttlSeconds: number): Promise<boolean>;
  /** Releases this worker's claim (agent left the room normally). */
  releaseAgentClaim(roomId: string, workerId: string): Promise<void>;
  /** Persists one transcript turn (seq is assigned by the store). */
  appendTurn(roomId: string, turn: InterviewTurnInput): Promise<void>;
  /** Full ordered transcript for a room. */
  getTurns(roomId: string): Promise<InterviewTurn[]>;
  /** Marks a session completed once the agent has left (sets completedAt). */
  completeSession(roomId: string): Promise<void>;
}