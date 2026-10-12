import type {
  InterviewReport,
  ReportIntegritySummary,
} from "./report.types";
import type { TranscriptTurn } from "./report.types";

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

/**
 * The interview session record. Older sessions only carry the original
 * fields; everything the pre-interview pipeline adds (email, role, JD,
 * resume, consent, …) is read defensively by the dashboard.
 */
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
export interface InterviewTurn extends TranscriptTurn {
  roomId: string;
}

export interface InterviewTurnInput {
  speaker: "interviewer" | "candidate";
  text: string;
  askedAt: string | null;
  answeredAt: string | null;
  latencyMs: number | null;
}

/** Which report column state a dashboard row is in. */
export type ReportState = "ready" | "processing" | "not-started";

/**
 * Filters/sorting/pagination for the recruiter dashboard list. `email` is the
 * legacy single-field filter, kept for compatibility; `search` matches
 * candidate name/email, role title, recruiter name and session title.
 * Status filtering follows the lazily-displayed expiry semantics (a finished
 * scheduled/waiting/active session shows as "expired").
 */
export interface DashboardListFilter {
  /** Case-insensitive substring match on candidate email (legacy). */
  email?: string;
  /** Case-insensitive substring across candidate, role, recruiter, title. */
  search?: string;
  /** Session status filter (display semantics, incl. "expired"). */
  status?: InterviewStatus;
  /** Report column state filter. */
  reportState?: ReportState;
  /** Only sessions created at or after this ISO timestamp. */
  from?: string;
  /** Only sessions created before this ISO timestamp. */
  to?: string;
  /** Sort direction on created_at (default: desc). */
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Recent sessions still waiting for their report — drives the bell menu. */
export interface DashboardAwaitingItem {
  roomId: string;
  candidateName: string | null;
  roleTitle: string | null;
  /** ISO 8601 — completion time when known, else creation time. */
  at: string;
}

/**
 * Dashboard analytics, computed from real rows only. Trends compare the last
 * 30 days with the 30 days before that; a trend is null when the previous
 * period has no data, so no invented percentages are ever shown. `series` is
 * the genuine per-day counts for the last 14 days.
 */
export interface DashboardAnalytics {
  total: number;
  reportsReady: number;
  awaitingAnalysis: number;
  /** reportsReady / total, 0-100 rounded; 0 when there are no sessions. */
  completionRate: number;
  trends: {
    total: number | null;
    reportsReady: number | null;
    awaitingAnalysis: number | null;
    completionRate: number | null;
  };
  series: { date: string; interviews: number; reports: number }[];
  awaitingRecent: DashboardAwaitingItem[];
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
 *
 * Sessions and transcript turns are WRITTEN by the pre-interview pipeline
 * workstream; the dashboard side only reads them. Reports are owned by the
 * dashboard side.
 */
export interface InterviewRepository {
  save(room: InterviewRoom): Promise<void>;
  get(id: string): Promise<InterviewRoom | null>;
  /**
   * Sessions, newest first, with optional dashboard filters. Only fields
   * that exist in storage are returned; absent pipeline fields stay undefined.
   */
  list(filter?: DashboardListFilter): Promise<InterviewRoom[]>;
  /** Total rooms matching the same filter, for server-side pagination. */
  count(filter?: DashboardListFilter): Promise<number>;
  /** Candidate answer-turn counts per room id (missing rooms count 0). */
  getCandidateTurnCounts(roomIds: readonly string[]): Promise<Map<string, number>>;
  /** Real-data analytics for the dashboard cards, bell and sparklines. */
  getDashboardAnalytics(): Promise<DashboardAnalytics>;
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
  /** Full ordered transcript for a room (each turn carries its roomId). */
  getTurns(roomId: string): Promise<InterviewTurn[]>;
  /** Marks a session completed once the agent has left (sets completedAt). */
  completeSession(roomId: string): Promise<void>;
  /**
   * Permanently removes a session and everything belonging to it (transcript
   * turns, report). Returns true when a session was deleted, false when the
   * room id does not exist.
   */
  deleteInterview(roomId: string): Promise<boolean>;
  /** Stores a generated report, replacing any previous one for the room. */
  saveReport(report: InterviewReport): Promise<void>;
  /** The generated report, or null when none exists yet. */
  getReport(roomId: string): Promise<InterviewReport | null>;
  /**
   * Integrity summaries for many rooms in one call (dashboard list badges).
   * Rooms without a report are simply absent from the map.
   */
  getReportIntegrity(roomIds: readonly string[]): Promise<Map<string, ReportIntegritySummary>>;
}