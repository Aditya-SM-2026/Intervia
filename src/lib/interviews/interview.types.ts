import type { InterviewPlan } from "./plan.types";
import type { Scorecard, ScorecardSummary } from "./scorecard.types";

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
 * Interviewer style: how hard the AI interviewer pushes and how many
 * follow-ups it asks per topic (see agent/intervia_agent/prompts.py).
 */
export type DifficultyLevel = "easy" | "medium" | "hard" | "extra-hard";

/**
 * How the live voice model is run for an interview (see agent worker).
 * "standard": one model session for the whole interview.
 * "rolling": a fresh model session at each topic change and every minute or
 * two, carrying the conversation as text, so earlier audio is not re-billed.
 */
export type VoiceMode = "standard" | "rolling";

export const VOICE_MODES: readonly VoiceMode[] = ["standard", "rolling"];

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
  /**
   * Where the candidate's original file is kept (in the recordings bucket).
   * Interviews created before this existed only have the extracted text.
   */
  objectPath?: string;
}

/** Candidate consent captured at the email gate, before joining. */
export interface ConsentRecord {
  /** ISO 8601 timestamp of when consent was given. */
  givenAt: string;
}

/** How one planned competency went, as recorded by the agent's controller. */
export interface CoverageEntry {
  competencyId: string;
  name: string;
  status: "covered" | "skipped" | "pending";
  startedAtSeconds: number | null;
  endedAtSeconds: number | null;
  budgetSeconds: number | null;
  /** The interviewer's one-line note when it left the topic. */
  interviewerSummary: string | null;
  interviewerEvidence: string | null;
  /** "controller" when the time budget, not the interviewer, moved it on. */
  advancedBy: "interviewer" | "controller" | null;
}

/** Written once by the agent worker when the live interview ends. */
export interface SessionOutcome {
  /** interviewer_ended, time_up, candidate_left, session_closed. */
  reason: string;
  startedAt: string | null;
  endedAt: string;
  elapsedSeconds: number;
  coverage: CoverageEntry[];
  /** Model usage as reported by the voice session (for cost tracking). */
  usage: unknown[];
  /** How many voice-model sessions the interview used (1 in standard mode). */
  modelSessions?: number;
}

/** The hiring decision. Always made by a person; the scorecard only advises. */
export interface HumanDecision {
  outcome: "advance" | "hold" | "reject";
  note: string;
  decidedAt: string;
}

/** The interview session record. */
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
  /** ISO 8601 moment the interview is scheduled for; null when it may start any time. */
  scheduledAt: string | null;
  /** ISO 8601 moment the 30-minute reminder email was sent; null while pending. */
  reminderSentAt: string | null;
  /** Secret token for the candidate's one-time resume-upload link. */
  uploadToken: string | null;
  /** ISO 8601 moment the upload link was consumed; the link is one-time. */
  uploadUsedAt: string | null;
  /** Session fields (see docs/PRE_INTERVIEW_PLAN.md). */
  recruiterName: string | null;
  /** The only email that may open this link; the join token is issued after it matches. */
  candidateEmail: string | null;
  roleTitle: string | null;
  /**
   * The hiring role this interview belongs to (roles module). Null for
   * interviews created before the roles module or without a role; those can
   * still be associated with a role by legacy role-title matching.
   */
  roleId: string | null;
  /** Interviewer style chosen by the recruiter (default: medium). */
  difficulty: DifficultyLevel;
  /** Interview length in minutes (10-45); enforced by the agent's controller. */
  durationMinutes: number;
  /** How the voice model is run; chosen by the recruiter (default: standard). */
  voiceMode: VoiceMode;
  jobDescription: JobDescription | null;
  resume: ResumeInfo | null;
  consent: ConsentRecord | null;
  /** ISO 8601 timestamp set when the agent session ends. */
  completedAt: string | null;
  /** Structured plan the interviewer follows and the scorecard grades against. */
  plan: InterviewPlan | null;
  outcome: SessionOutcome | null;
  decision: HumanDecision | null;
}

export interface CreateInterviewInput {
  /** Display title; defaults to the role title when omitted. */
  title?: string;
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  /**
   * The hiring role to associate the interview with (roles module). Optional
   * so existing callers keep working; the recruiter form can send it once
   * Aditya's scheduling workflow passes it through.
   */
  roleId?: string;
  /** Interview length in minutes (10-45). Drives the plan size and pacing. */
  durationMinutes: number;
  /** How hard the interviewer pushes (default: medium). */
  difficulty: DifficultyLevel;
  voiceMode: VoiceMode;
  /** ISO 8601 scheduled moment, or null when the link may be used immediately. */
  scheduledAt?: string | null;
  jobDescription: JobDescription | null;
  resume: ResumeInfo | null;
}

export type TranscriptSpeaker = "interviewer" | "candidate";

/** One spoken turn, captured by the agent worker during the interview. */
export interface InterviewTurnInput {
  speaker: TranscriptSpeaker;
  text: string;
  /** ISO 8601 — when the speaker started and stopped talking. */
  startedAt: string | null;
  endedAt: string | null;
  /**
   * Candidate turns only: milliseconds between the interviewer finishing
   * and the candidate starting to speak. Null when they overlapped.
   */
  responseLatencyMs: number | null;
  /** The turn was cut short by the other side speaking. */
  interrupted: boolean;
  /** Interview phase when it was said: intro, topic, candidate_questions, closing. */
  phase: string | null;
  /** The plan competency under discussion, when in a topic. */
  competencyId: string | null;
}

export interface InterviewTurn extends InterviewTurnInput {
  roomId: string;
  /** Order within the interview, assigned by the store. */
  seq: number;
}

/** One entry of the append-only interview event log. */
export interface InterviewEventInput {
  /** e.g. interview_started, topic_changed, client_tab_hidden, candidate_state. */
  type: string;
  /** ISO 8601. */
  at: string;
  data: Record<string, unknown>;
}

export interface InterviewEvent extends InterviewEventInput {
  roomId: string;
  seq: number;
}

/** Optional filters/slicing for the recruiter dashboard list. */
export interface DashboardListFilter {
  /** Case-insensitive substring match on candidate email. */
  email?: string;
  /** Keep only rooms whose raw status matches one of these. */
  status?: InterviewStatus[];
  limit?: number;
  offset?: number;
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
 * Storage boundary. Postgres when DATABASE_URL is set, in-memory otherwise;
 * route handlers and services only ever see this interface.
 *
 * Turns, events and the outcome are written by the agent worker through
 * /api/agent/*; scorecards by the scoring pipeline; decisions by recruiters.
 */
export interface InterviewRepository {
  save(room: InterviewRoom): Promise<void>;
  /**
   * Atomically claims every interview whose reminder is due (scheduled,
   * not yet joined, reminder not sent, scheduled 0-30 minutes from `now`)
   * by stamping reminder_sent_at, and returns the claimed room ids. Safe to
   * call concurrently (multiple server instances never double-send).
   */
  claimDueReminders(now: string): Promise<string[]>;
  /**
   * Inserts a new room while holding a per-duplicate-key lock, so two
   * simultaneous identical creations cannot both succeed. Returns the
   * existing room when another creation of the same slot won the race.
   */
  insertRoomAtomically(
    room: InterviewRoom,
    duplicateKey: string,
  ): Promise<{ created: true } | { created: false; existing: InterviewRoom }>;
  get(id: string): Promise<InterviewRoom | null>;
  /** Sessions, newest first, with optional dashboard filters. */
  list(filter?: DashboardListFilter): Promise<InterviewRoom[]>;
  /** Appends turns in order (seq is assigned by the store). */
  appendTurns(roomId: string, turns: readonly InterviewTurnInput[]): Promise<void>;
  getTurns(roomId: string): Promise<InterviewTurn[]>;
  appendEvents(roomId: string, events: readonly InterviewEventInput[]): Promise<void>;
  getEvents(roomId: string): Promise<InterviewEvent[]>;
  saveScorecard(scorecard: Scorecard): Promise<void>;
  getScorecard(roomId: string): Promise<Scorecard | null>;
  /** Scorecard summaries for many rooms in one call (dashboard list badges). */
  getScorecardSummaries(roomIds: readonly string[]): Promise<Map<string, ScorecardSummary>>;
}
