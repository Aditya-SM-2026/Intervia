import type {
  AnswerGaze,
  AuthenticitySignal,
  CompetencyScore,
  FactorId,
  GazePattern,
  OverallScore,
  ResumeClaim,
  VideoMoment,
} from "./scorecard.types.ts";

/**
 * The arithmetic behind the scorecard. Models produce the observations
 * (scores per question, verdicts per resume claim, flagged moments); every
 * number shown to a recruiter is then computed here, in plain code, so the
 * same observations always give the same score and the rules can be read.
 *
 * No imports with side effects: this file is also run directly by the tests.
 */

/** Percent of the overall score each factor carries when all four are present. */
export const DEFAULT_WEIGHTS: Record<FactorId, number> = {
  answers: 45,
  resume: 20,
  authenticity: 20,
  video: 15,
};

export const FACTOR_ORDER: FactorId[] = ["answers", "resume", "authenticity", "video"];

/** Weights from a "45,20,20,15" setting; falls back to the defaults. */
export function parseWeights(setting: string | undefined): Record<FactorId, number> {
  const parts = (setting ?? "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value) || value < 0)) {
    return DEFAULT_WEIGHTS;
  }
  if (parts.reduce((sum, value) => sum + value, 0) <= 0) return DEFAULT_WEIGHTS;
  return { answers: parts[0], resume: parts[1], authenticity: parts[2], video: parts[3] };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Answer quality, 0-100: the scored competencies (1-5 each) averaged by their
 * share of the interview plan. A 3, "meets the bar", is 60; a 5 is 100.
 */
export function answerQualityScore(
  competencies: readonly CompetencyScore[],
  planMinutes: ReadonlyMap<string, number>,
): number | null {
  let total = 0;
  let weight = 0;
  for (const item of competencies) {
    if (item.status !== "scored" || item.score === null) continue;
    const share = planMinutes.get(item.competencyId) ?? 1;
    total += item.score * share;
    weight += share;
  }
  return weight === 0 ? null : clampScore((total / weight / 5) * 100);
}

const CLAIM_CREDIT = { confirmed: 1, partly_supported: 0.5, not_supported: 0 } as const;

/** Fewer checked claims than this cannot support a resume-match score. */
export const MIN_CLAIMS_FOR_SCORE = 2;

/**
 * Resume match, 0-100: of the resume claims the interview actually got to,
 * how many the candidate's own account backed up. Claims that were never
 * discussed do not count for or against.
 */
export function resumeMatchScore(claims: readonly ResumeClaim[]): number | null {
  const checked = claims.filter((claim) => claim.verdict !== "not_discussed");
  if (checked.length < MIN_CLAIMS_FOR_SCORE) return null;
  const credit = checked.reduce(
    (sum, claim) => sum + CLAIM_CREDIT[claim.verdict as keyof typeof CLAIM_CREDIT],
    0,
  );
  return clampScore((credit / checked.length) * 100);
}

const SIGNAL_PENALTY = { 1: 6, 2: 14, 3: 26 } as const;

/**
 * Own answers, 0-100: starts at 100 and loses points for each signal that an
 * answer was read out or prompted. No signals means 100, not "proven honest".
 */
export function authenticityScore(signals: readonly AuthenticitySignal[]): number {
  const lost = signals.reduce((sum, signal) => sum + SIGNAL_PENALTY[signal.severity], 0);
  return clampScore(100 - lost);
}

const MOMENT_PENALTY: Record<VideoMoment["kind"], number> = {
  looking_away: 5,
  reading: 12,
  other_person: 28,
  second_device: 20,
  left_frame: 8,
  other: 4,
};

/** Answers shorter than this say too little about where someone looks. */
export const MIN_GAZE_ANSWER_SECONDS = 4;
/** Below this many judged answers there is no pattern to speak of. */
export const MIN_ANSWERS_FOR_PATTERN = 3;

function mostCommon<T>(values: readonly T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * The pattern across answers. The candidate's usual direction while
 * listening is taken as the interview window; an answer counts towards the
 * pattern only when the eyes were held steadily somewhere else. What matters
 * is how many answers share the same such spot.
 */
export function gazePattern(answers: readonly AnswerGaze[]): GazePattern {
  const judged = answers.filter(
    (answer) =>
      answer.durationSeconds >= MIN_GAZE_ANSWER_SECONDS && answer.whileAnswering !== "unclear",
  );
  const listening = mostCommon(
    answers.map((answer) => answer.whileListening).filter((direction) => direction !== "unclear"),
  );
  const listeningDirection = listening?.value ?? null;
  const offScreen = judged.filter(
    (answer) =>
      answer.steady &&
      answer.whileAnswering !== (listeningDirection ?? "centre") &&
      // Without a listening baseline, straight ahead is taken as the screen.
      answer.whileAnswering !== "centre",
  );
  const spot = mostCommon(offScreen.map((answer) => answer.whileAnswering));
  return {
    answersObserved: judged.length,
    listeningDirection,
    direction: spot?.value ?? null,
    sameSpotAnswers: spot?.count ?? 0,
    readingAnswers: judged.filter((answer) => answer.reading).length,
  };
}

/**
 * On-camera behaviour, 0-100: starts at 100 and loses points for
 * - the share of answers given while looking at one same spot off the screen
 *   (the main signal: up to 60 points when it is every answer),
 * - answers with reading-like eye movement,
 * - other flagged moments (another person, a second device, leaving the picture),
 * - time spent outside the interview tab.
 * A single look away costs little or nothing; a repeated pattern adds up.
 */
export function videoBehaviourScore(
  moments: readonly VideoMoment[],
  tab: { hiddenCount: number; hiddenSeconds: number },
  pattern: GazePattern | null = null,
): number {
  let lost = 0;
  for (const moment of moments) {
    lost += MOMENT_PENALTY[moment.kind] + Math.min(6, moment.durationSeconds / 10);
  }
  if (pattern && pattern.answersObserved >= MIN_ANSWERS_FOR_PATTERN) {
    // Two answers on the same spot can be chance; from there it scales.
    if (pattern.sameSpotAnswers >= 2) {
      lost += 60 * (pattern.sameSpotAnswers / pattern.answersObserved);
    }
    lost += Math.min(30, pattern.readingAnswers * 10);
  }
  lost += Math.min(30, tab.hiddenCount * 4 + tab.hiddenSeconds / 6);
  return clampScore(100 - lost);
}

/**
 * Overall, 0-100: the weighted average of the factors that have a score.
 * Missing factors are left out and the remaining weights carry the total.
 */
export function overallScore(
  scores: Record<FactorId, number | null>,
  weights: Record<FactorId, number> = DEFAULT_WEIGHTS,
): OverallScore {
  const factors = FACTOR_ORDER.map((id) => ({ id, score: scores[id], weight: weights[id] }));
  // Without scored answers there is nothing to anchor a total on.
  if (scores.answers === null) return { score: null, factors };

  let total = 0;
  let weight = 0;
  for (const factor of factors) {
    if (factor.score === null || factor.weight <= 0) continue;
    total += factor.score * factor.weight;
    weight += factor.weight;
  }
  return { score: weight === 0 ? null : clampScore(total / weight), factors };
}

export interface TimedAnswer {
  seq: number;
  responseLatencyMs: number | null;
  durationMs: number | null;
  wordCount: number;
}

/**
 * Signals that need no judgement, only the recorded timings: a long,
 * structured answer that began almost at once, when the same candidate
 * normally pauses before answering.
 */
export function measuredAuthenticitySignals(answers: readonly TimedAnswer[]): AuthenticitySignal[] {
  const latencies = answers
    .map((answer) => answer.responseLatencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (latencies.length < 4) return [];
  const usual = latencies[Math.floor(latencies.length / 2)];

  const instant = answers.filter(
    (answer) =>
      answer.responseLatencyMs !== null &&
      answer.responseLatencyMs < 500 &&
      answer.responseLatencyMs < usual / 3 &&
      answer.wordCount >= 90,
  );
  if (instant.length === 0) return [];

  return [
    {
      title:
        instant.length === 1
          ? "A long answer started almost instantly"
          : `${instant.length} long answers started almost instantly`,
      detail: `The candidate usually paused about ${(usual / 1000).toFixed(1)} s before answering, but ${
        instant.length === 1 ? "this answer" : "these answers"
      } of 90 words or more began within half a second.`,
      turnSeqs: instant.map((answer) => answer.seq),
      severity: instant.length >= 3 ? 3 : instant.length === 2 ? 2 : 1,
      source: "measured",
    },
  ];
}
