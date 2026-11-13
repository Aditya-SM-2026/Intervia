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
  /**
   * The four things an answer is judged on, 1-5 each (absent on reports made
   * before 2026-11). The score above is capped by them in code: an answer
   * that misses the question, or only recites a definition, cannot score high.
   */
  dimensions?: AnswerDimensions | null;
  /** The answer only defined terms, with nothing the candidate did or decided. */
  definitionOnly?: boolean;
  /**
   * Whether the answers to this question sounded like the candidate's own
   * words (the weakest reading among them). Part of answer quality.
   */
  originality?: "natural" | "polished" | "likely_read";
}

export interface AnswerDimensions {
  /** Took up the question that was asked. */
  relevance: number | null;
  /** Concrete first-person detail: what they built, chose, hit and fixed. */
  ownership: number | null;
  /** Technically right. */
  correctness: number | null;
  /** How and why, trade-offs, what failed. */
  depth: number | null;
}

/**
 * One recruiter-set custom parameter (a skill such as AWS, Kubernetes or
 * Communication) scored from the resume and the interview transcript.
 * Scores are 0-100 because different parameters have no shared 1-5 anchors.
 */
export interface CustomParameterScore {
  skill: string;
  /** The recruiter's emphasis for this parameter in this interview, 0-100. */
  weight: number;
  status: CompetencyStatus;
  /** 0-100; null unless status is "scored". */
  score: number | null;
  rationale: string;
  /** Candidate quotes, verified against the stored transcript. */
  evidence: ScoreEvidence[];
  /** What the resume says about this parameter, or null when it says nothing. */
  resumeEvidence: string | null;
  /** What would have made the evidence stronger. */
  gaps: string[];
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
  /** Times the candidate left the interview (full screen, tab, or Leave). */
  pauseCount: number;
  /** Total time the interview stood paused waiting for them, in seconds. */
  pausedSeconds: number;
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

/** What stands out on the resume itself, read from the resume alone. */
export interface ResumeProfile {
  /** Total years of professional work, rounded to a half; null when the resume does not say. */
  experienceYears: number | null;
  /** Short label when years do not fit, e.g. "Fresher" or "2 internships"; empty otherwise. */
  experienceNote: string;
  /** Most recent role and employer, e.g. "BW/4HANA developer at Apprisia Consulting". */
  currentRole: string;
  /** Highest qualification, e.g. "B.Tech, Arya College". */
  education: string;
  /** Up to six skills the resume shows real work in, strongest first. */
  topSkills: string[];
  /** Up to three things that make this resume stand out: results, notable projects, certifications. */
  standouts: string[];
}

/** Whether the interview backs up the resume. */
export interface ResumeMatch {
  /** 0-100 over the claims that were actually discussed; null when too few were. */
  score: number | null;
  claims: ResumeClaim[];
  /** How the resume lines up with the job description's main requirements. */
  jobFit?: { requirement: string; level: "strong" | "some" | "none"; evidence: string }[];
  /** The resume at a glance; missing on reports made before it existed. */
  profile?: ResumeProfile;
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
  /**
   * Points this signal takes off, when the count matters more than a category
   * (answers that never took up the question). Defaults to the severity cost.
   */
  penalty?: number;
}

/** How one answer was delivered, compared with how this candidate normally talks. */
export type OwnAnswerVerdict = "natural" | "polished" | "likely_read";

export interface OwnAnswerReading {
  turnSeq: number;
  verdict: OwnAnswerVerdict;
  /** Short, plain reasons pointing at what was said. */
  reasons: string[];
}

export interface Authenticity {
  /**
   * 0-100, higher = more consistent with the candidate's own answers. Null
   * when the check did not run: "not checked" is never shown as a clean 100.
   */
  score: number | null;
  signals: AuthenticitySignal[];
  /** Absent on reports made before 2026-11, which always ran the check. */
  status?: "checked" | "not_checked";
  reason?: string | null;
  /** Per-answer reading of the delivery, when the check ran. */
  answers?: OwnAnswerReading[];
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
  /** Handed to the analysis worker; the result arrives by callback. */
  | "queued"
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
  /** When the answer could not be read: why, in plain words. */
  reason?: string | null;
  /** Frames inside the answer that gave a usable reading. */
  measuredFrames?: number;
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
  /** When the analysis was handed to the worker (ISO), used to spot a lost job. */
  queuedAt?: string | null;
  /** 2 = calibrated analysis with audio checks (2026-11). Absent on older reports. */
  version?: 2;
  /** The calibrated measurements, kept so findings can be recomputed and shown. */
  measures?: VideoMeasures | null;
}

/** Picture conditions for an answer or the whole interview. */
export interface PictureQuality {
  /** Mean brightness, 0-255. */
  brightness: number | null;
  /** Median face width in pixels. */
  facePx: number | null;
  /** Laplacian variance of the face area: low = soft, blurry picture. */
  sharpness: number | null;
  /** Share of frames where eyes could be read. */
  measurable: number;
  /** Share of frames that had to be brightened first. */
  enhanced: number;
}

export interface GazeSpot {
  id: number;
  /** Raw gaze position of the spot (same units as the baseline). */
  x?: number;
  y?: number;
  /** In plain words, relative to the candidate's own screen position. */
  where: string;
  /** Distance from the screen centre, in units of the candidate's own spread. */
  distance: number;
  /** Candidate turns during which the eyes stayed on this spot. */
  heldAnswers: number[];
  /** Share of listening time spent on this spot (low = only used while answering). */
  listeningShare: number;
}

export interface AnswerDelivery {
  words: number;
  spokenSeconds: number;
  wordsPerMinute: number;
  /** "um", "uh"… per 100 words. */
  fillersPer100: number;
  /** Repeated words and restarted phrases per 100 words. */
  repeatsPer100: number;
  longPauses: number;
  pauseShare: number;
  /** How uneven the pace was; low = very steady, as in reading. */
  paceVariation: number | null;
  startDelay: number;
  /** Seconds to the first real (non-filler) word: a stall while a tool writes shows here. */
  firstContentDelay?: number;
  /** Hesitations per 100 words after the first ten words; null for short answers. */
  restDisfluencyPer100?: number | null;
}

export interface AnswerMeasures {
  turnSeq: number;
  start: number;
  end: number;
  measuredFrames: number;
  totalFrames: number;
  quality: PictureQuality;
  reason?: string | null;
  /** Share of the answer spent looking at the screen (calibrated to this person). */
  atScreenShare: number | null;
  /** Share of the answer (after the first 2 s) spent on the main off-screen spot. */
  spotShare?: number | null;
  /** Seconds into the answer before the eyes first reached that spot. */
  spotOnset?: number | null;
  /** Distinct off-screen directions used: many = wandering, as in thinking. */
  offScreenDirections?: number;
  reading?: { sweeps: number; perMinute: number; direction: number | null } | null;
  /** Median gaze offset from the screen centre, in the candidate's own spreads [x, y]. */
  medianOffset?: [number, number] | null;
  lipSync?: { correlation: number | null; lag: number | null; voicedFrames: number } | null;
  multiFaceSeconds: number;
  phoneSeconds: number | null;
  extraPersonSeconds: number | null;
  sampledSeconds: number;
  pauseOffScreenShare?: number | null;
  delivery?: AnswerDelivery | null;
  /** Cosine similarity of this answer's voice to the candidate's other answers. */
  voiceSimilarity?: number | null;
}

export interface VideoMeasures {
  fps: number;
  /** Where this person looks while listening (their screen), and how tightly. Raw gaze units. */
  baseline: { frames: number; source: "listening" | "all" | "none"; x?: number; y?: number; sx?: number; sy?: number };
  spots: GazeSpot[];
  answers: AnswerMeasures[];
  absences: { atSeconds: number; durationSeconds: number }[];
  quality: PictureQuality;
  faceSeen: boolean;
  checks: { audio: boolean; transcriber: boolean; voice: boolean; phone: boolean };
  partial: boolean;
  processingSeconds: number;
}

/** Where a finding comes from. High risk needs two different sources to agree. */
export type IntegritySource = "video" | "audio" | "text" | "browser";

export type IntegrityFindingKind =
  | "fixed_spot"
  | "reading_eyes"
  | "screen_reading"
  | "stall_then_fluent"
  | "lip_sync"
  | "voice_change"
  | "second_face"
  | "phone"
  | "read_aloud"
  | "scripted_text"
  | "left_tab"
  | "left_frame";

export interface IntegrityFinding {
  kind: IntegrityFindingKind;
  source: IntegritySource;
  /** 1 = worth a glance, 2 = notable, 3 = strong. */
  strength: 1 | 2 | 3;
  title: string;
  detail: string;
  /** Candidate turns it is about; empty for interview-wide findings. */
  turnSeqs: number[];
  /** Where to start watching, in seconds into the recording. */
  atSeconds: number | null;
}

/**
 * - clear: the checks ran and nothing stood out;
 * - review: something is worth watching before deciding;
 * - high_risk: two different kinds of evidence agree on the same answers;
 * - pending: the video and audio checks are still running;
 * - not_checked: none of the checks could run.
 */
export type IntegrityLevel = "clear" | "review" | "high_risk" | "pending" | "not_checked";

export type CheckState = "done" | "running" | "not_run" | "unavailable";

/**
 * Whether the answers were the candidate's own. Kept apart from the ability
 * score on purpose: an honest candidate does not earn points for honesty, and
 * a strong candidate is held for review, not marked down, when it is unclear.
 */
export interface IntegrityCheck {
  level: IntegrityLevel;
  /** Two or three plain sentences for the recruiter. */
  summary: string;
  findings: IntegrityFinding[];
  checks: {
    ownAnswers: CheckState;
    camera: CheckState;
    voice: CheckState;
    lipSync: CheckState;
    browser: CheckState;
  };
  /** Plain notes on what limited the checks (dim picture, no audio…). */
  limits: string[];
  /** Who wrote the summary: the model, or code when the model was unavailable. */
  summaryBy: "model" | "code";
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
  /**
   * Answer quality per part of a two-part interview (plans from 2026-11):
   * their own projects in depth, and what the job needs. Null for a part the
   * interview did not have or did not reach.
   */
  partScores?: { projects: number | null; requirements: number | null } | null;
  /** Good answers (3+ of 5) in the candidate's own words, out of scored questions. */
  ownAnswers?: { scored: number; good: number; goodOwn: number } | null;
  resumeMatch?: ResumeMatch;
  authenticity?: Authenticity;
  video?: VideoBehaviour;
  overall?: OverallScore;
  /**
   * Recruiter-set custom parameters scored from the resume and answers.
   * Absent when the interview had no custom scoring, so older scorecards and
   * untouched interviews look exactly as before.
   */
  customParameters?: CustomParameterScore[];
  /** Weighted 0-100 mean of the custom parameters that could be scored. */
  customScore?: number | null;
  /**
   * Integrity, separate from the score (2026-11). Absent on older reports,
   * which blended own answers and on-camera behaviour into the score.
   */
  integrityCheck?: IntegrityCheck;
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
  /** Integrity level, when the report has one. */
  integrityLevel?: IntegrityLevel | null;
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
  /**
   * What HR said, in order. Captured as text by the HR page, never fed to the
   * interviewer. Empty when no HR joined or their browser could not caption.
   */
  hrSpeech: HrSpeechEntry[];
}

/** A line HR spoke during the interview, used for the HR↔candidate section. */
export interface HrSpeechEntry {
  text: string;
  /** ISO 8601 when HR said it, or null when the caption carried no clock. */
  at: string | null;
}
