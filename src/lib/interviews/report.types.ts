import type { InterviewRoom } from "./interview.types";

/**
 * Post-interview report domain. Reports are recruiter-only — never shown to
 * the candidate — and contain no secrets, so these types are shared between
 * server and client.
 *
 * The transcript turns a report analyzes are written by the interview
 * pipeline (see docs/PRE_INTERVIEW_PLAN.md); every integrity signal and JD
 * coverage entry cites turn `seq` numbers so each claim is traceable to a
 * transcript line.
 */

/** Who said a transcript turn. The AI interviewer is "interviewer". */
export type TranscriptSpeaker = "interviewer" | "candidate";

/**
 * One transcript turn, as stored incrementally by the interview pipeline.
 * `askedAt` is set on interviewer turns, `answeredAt`/`latencyMs` on
 * candidate turns; fields may be null on partial or legacy data.
 */
export interface TranscriptTurn {
  seq: number;
  speaker: TranscriptSpeaker;
  text: string;
  /** ISO 8601 — when the interviewer's question was sent. */
  askedAt: string | null;
  /** ISO 8601 — when the candidate's final answer arrived. */
  answeredAt: string | null;
  /** answeredAt − askedAt for candidate turns; a free AI-usage signal. */
  latencyMs: number | null;
}

/** Summary of what the candidate answered for one topic that came up. */
export interface ReportTopicSummary {
  topic: string;
  summary: string;
}

/** One JD skill and whether the interviewer probed it (with evidence turns). */
export interface JdCoverageEntry {
  skill: string;
  probed: boolean;
  /** Turn seqs where the skill was probed (or where its absence shows). */
  evidenceTurnSeq: number[];
}

export interface ReportAnalysis {
  /** Per-topic answer summaries, in the order the topics came up. */
  topics: ReportTopicSummary[];
  strengths: string[];
  weaknesses: string[];
  /** Which required skills were probed vs skipped, grounded in turns. */
  jdCoverage: JdCoverageEntry[];
}

/**
 * Integrity level derived from the probability (in code, never by the LLM):
 * low < 40, medium 40-69, high >= 70.
 */
export type IntegrityLevel = "low" | "medium" | "high";

/**
 * One integrity signal. The type is an intentionally open string so future
 * analysis passes (video/behavioral) can add kinds without schema changes.
 * Known transcript-grounded types: "instant-polished-answer",
 * "templated-phrasing", "contradiction-on-repeat", "refusal-to-elaborate",
 * "resume-answer-mismatch", "copy-like-prose", "generic-answers".
 */
export interface IntegritySignal {
  type: string;
  description: string;
  /** Turn seqs the claim is traceable to — never invented. */
  evidenceTurnSeq: number[];
  /** 0-100 contribution of this signal to the overall probability. */
  weight: number;
}

export interface ReportIntegrity {
  /** Estimated 0-100 probability that answers were AI-generated or heavily AI-assisted. */
  probability: number;
  level: IntegrityLevel;
  signals: IntegritySignal[];
}

/** Which analysis engine produced a report. */
export interface ReportEngineMeta {
  model: string;
  generatedAt: string;
}

/** A complete generated report for one interview room. */
export interface InterviewReport {
  roomId: string;
  /** ISO 8601 generation time. */
  generatedAt: string;
  analysis: ReportAnalysis;
  integrity: ReportIntegrity;
  engineMeta: ReportEngineMeta;
  /**
   * Data-quality notes surfaced to the recruiter: missing consent,
   * unreadable resume (JD-only assessment), missing JD, etc.
   */
  notes: string[];
}

/** Integrity summary shown as a badge on the dashboard list. */
export interface ReportIntegritySummary {
  probability: number;
  level: IntegrityLevel;
}

/** One dashboard list entry: the session plus its report integrity, if any. */
export interface DashboardInterviewSummary {
  room: InterviewRoom;
  integrity: ReportIntegritySummary | null;
}

/** Shape of GET /api/dashboard/interviews. */
export interface DashboardInterviewsResponse {
  interviews: DashboardInterviewSummary[];
}

/** Shape of GET /api/dashboard/interviews/[roomId]/report. */
export interface InterviewReportResponse {
  session: InterviewRoom;
  /** Turns written by the interview pipeline; empty when none exist. */
  turns: TranscriptTurn[];
  /** Null when no report could be generated — `reason` says why. */
  report: InterviewReport | null;
  reason: string | null;
}