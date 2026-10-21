import type {
  InterviewEvent,
  InterviewRoom,
  InterviewTurn,
} from "./interview.types";

/**
 * Post-interview scorecard. Recruiter-only, never shown to the candidate.
 *
 * Every score cites candidate quotes by transcript turn, and the citations
 * are verified in code against the stored transcript: a score whose evidence
 * cannot be found in what the candidate actually said is withdrawn. The
 * scorecard is a recommendation; the hiring decision is recorded separately
 * by a person (see HumanDecision).
 */

export interface ScoreEvidence {
  /** Sequence number of the candidate turn the quote comes from. */
  turnSeq: number;
  /** Verbatim words from that turn. */
  quote: string;
}

export type CompetencyStatus =
  /** Scored 1-5 with verified evidence. */
  | "scored"
  /** The interview never reached this competency. */
  | "not_assessed"
  /** It was discussed, but nothing the candidate said supports a score. */
  | "insufficient_evidence";

export interface CompetencyScore {
  competencyId: string;
  name: string;
  status: CompetencyStatus;
  /** 1-5 against the plan's anchors; null unless status is "scored". */
  score: number | null;
  rationale: string;
  evidence: ScoreEvidence[];
  /** What a stronger answer would have included. */
  gaps: string[];
  /** Independent second grading of the same transcript, when it ran. */
  secondScore: number | null;
  /** False when the two gradings differ by more than one point. */
  judgesAgree: boolean | null;
}

/** An observation about answer authenticity, tied to transcript turns. */
export interface IntegrityNote {
  description: string;
  turnSeqs: number[];
}

/**
 * Integrity signals. The counts are measured, not inferred: they come from
 * the event log. Notes are the grader's observations and are advisory.
 * Deliberately no single "cheating probability": it would not be reliable.
 */
export interface IntegritySignals {
  tabHiddenCount: number;
  tabHiddenSeconds: number;
  windowBlurCount: number;
  candidateDisconnects: number;
  /** Median gap between the interviewer finishing and the candidate starting. */
  medianResponseLatencyMs: number | null;
  notes: IntegrityNote[];
}

/** How a claim on the resume held up against what the candidate said. */
export type ResumeVerdict = "confirmed" | "partly_supported" | "not_supported" | "not_discussed";

export interface ResumeClaim {
  /** A project, role, skill or result stated on the resume. */
  claim: string;
  verdict: ResumeVerdict;
  /** Why, in one sentence. */
  note: string;
  /** Candidate turns the verdict rests on (empty for "not_discussed"). */
  turnSeqs: number[];
}

/** Whether the interview backs up the resume. */
export interface ResumeMatch {
  /** 0-100 over the claims that were actually discussed; null when too few were. */
  score: number | null;
  claims: ResumeClaim[];
  /** Why there is no score, when there is none. */
  reason: string | null;
}

/**
 * One sign that an answer may not have been the candidate's own (read out,
 * or prompted by an AI tool). "measured" signals come from recorded timing;
 * "grader" signals are the grader's reading of the transcript.
 */
export interface AuthenticitySignal {
  title: string;
  detail: string;
  turnSeqs: number[];
  /** 1 = worth a glance, 2 = notable, 3 = strong. */
  severity: 1 | 2 | 3;
  source: "measured" | "grader";
}

export interface Authenticity {
  /** 0-100, higher = more consistent with the candidate's own answers. */
  score: number;
  signals: AuthenticitySignal[];
}

export type VideoMomentKind =
  | "looking_away"
  | "reading"
  | "other_person"
  | "second_device"
  | "left_frame"
  | "other";

/** A stretch of the candidate's recording that a reviewer should watch. */
export interface VideoMoment {
  atSeconds: number;
  durationSeconds: number;
  kind: VideoMomentKind;
  description: string;
}

/**
 * - analysed: the recording was analysed.
 * - no_recording: the interview was not recorded.
 * - not_configured: no video model or storage access is set up.
 * - failed: analysis was attempted and did not complete.
 */
export type VideoStatus =
  | "analysed"
  | "no_recording"
  | "not_configured"
  | "failed"
  /** Not attempted: the transcript was too thin to justify the cost. */
  | "skipped";

/** Where the eyes point, as seen in the picture (the viewer's left and right). */
export type GazeDirection =
  | "centre"
  | "left"
  | "right"
  | "up"
  | "down"
  | "up_left"
  | "up_right"
  | "down_left"
  | "down_right"
  | "unclear";

/** Where the candidate looked during one answer, and during the question before it. */
export interface AnswerGaze {
  /** The candidate turn this is about. */
  turnSeq: number;
  /** Seconds into the recording at which the answer starts. */
  atSeconds: number;
  durationSeconds: number;
  whileListening: GazeDirection;
  whileAnswering: GazeDirection;
  /** The eyes stayed on one spot for most of the answer. */
  steady: boolean;
  /** The eyes moved line by line, as when reading text. */
  reading: boolean;
  note: string;
}

/**
 * The pattern across answers, computed in code from the per-answer
 * observations. One look away means nothing; returning to the same spot off
 * the screen for answer after answer, and not while listening, is the signal.
 */
export interface GazePattern {
  /** Answers long enough, and visible enough, to judge. */
  answersObserved: number;
  /** Where the candidate usually looks while listening (the interview window). */
  listeningDirection: GazeDirection | null;
  /** The off-screen spot held most often while answering, if any. */
  direction: GazeDirection | null;
  /** Answers during which the eyes were held on that same spot. */
  sameSpotAnswers: number;
  readingAnswers: number;
}

/** What the candidate's camera recording shows, plus tab/window events. */
export interface VideoBehaviour {
  status: VideoStatus;
  /** 0-100, higher = fewer flagged moments; null unless analysed. */
  score: number | null;
  /** Share of the interview the candidate was looking at the screen. */
  attentionPercent: number | null;
  moments: VideoMoment[];
  summary: string;
  model: string | null;
  reason: string | null;
  /** Per-answer observations (absent on analyses made before 2026-10-12). */
  answers?: AnswerGaze[];
  pattern?: GazePattern | null;
  /** Length of the analysed recording. */
  durationSeconds?: number | null;
}

export type FactorId = "answers" | "resume" | "authenticity" | "video";

export interface FactorScore {
  id: FactorId;
  /** 0-100; null when the factor could not be scored for this interview. */
  score: number | null;
  /** Configured weight, in percent of the whole. */
  weight: number;
}

/**
 * The overall score: a weighted average of the factors that could be scored.
 * A factor without a score is left out and the rest are re-weighted, so a
 * missing recording does not drag the total down.
 */
export interface OverallScore {
  score: number | null;
  factors: FactorScore[];
}

export type ScoreSuggestion = "strong" | "positive" | "mixed" | "weak" | "insufficient";

export interface Scorecard {
  roomId: string;
  generatedAt: string;
  model: string;
  /** "live" = the transcript captured during the interview. */
  transcriptSource: "live";
  summary: string;
  strengths: string[];
  concerns: string[];
  competencies: CompetencyScore[];
  /** Time-weighted mean of the scored competencies; null when none scored. */
  overallScore: number | null;
  suggestion: ScoreSuggestion;
  integrity: IntegritySignals;
  /** Data-quality caveats for the reader (short interview, fallback plan…). */
  notes: string[];
  /** True when graders disagreed or evidence was withdrawn. */
  needsHumanReview: boolean;
  /**
   * The four-factor analysis. Optional because scorecards generated before it
   * existed do not have it; regenerating one adds it.
   */
  answerQuality?: number | null;
  resumeMatch?: ResumeMatch;
  authenticity?: Authenticity;
  video?: VideoBehaviour;
  overall?: OverallScore;
  /**
   * Cost guard: set when the transcript was too thin for the paid analyses,
   * listing what was skipped and the roughly estimated saving in US dollars.
   */
  costGuard?: { skipped: string[]; estimatedUsd: number; reason: string } | null;
}

export interface ScorecardSummary {
  overallScore: number | null;
  suggestion: ScoreSuggestion;
  needsHumanReview: boolean;
  /** The 0-100 overall score and its factors, when the scorecard has them. */
  overall?: OverallScore | null;
}

/** Another candidate interviewed for the same role, for side-by-side reading. */
export interface PeerSummary {
  roomId: string;
  candidateName: string | null;
  overall: OverallScore | null;
  decision: InterviewRoom["decision"];
}

/** One dashboard list entry. */
export interface DashboardInterviewSummary {
  room: InterviewRoom;
  scorecard: ScorecardSummary | null;
}

/** Shape of GET /api/dashboard/interviews. */
export interface DashboardInterviewsResponse {
  interviews: DashboardInterviewSummary[];
}

/** Shape of GET /api/dashboard/interviews/[roomId]. */
export interface InterviewDetailResponse {
  session: InterviewRoom;
  turns: InterviewTurn[];
  events: InterviewEvent[];
  /** Null when no scorecard exists; `reason` says why. */
  scorecard: Scorecard | null;
  reason: string | null;
  /** Scored interviews for the same role, this one included. */
  peers: PeerSummary[];
  /** Whether a candidate recording exists to play back. */
  hasRecording: boolean;
  /** When the recording used for playback and analysis began (ISO 8601). */
  recordingStartedAt: string | null;
}
