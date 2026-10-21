/**
 * A free, local read of how much usable interview evidence the transcript
 * carries. Decides before any paid model call whether the expensive analyses
 * (video frames, second grader, resume and authenticity checks) are worth
 * running. The recording itself is always kept; this only gates analysis.
 */

import type { InterviewTurn } from "./interview.types";

export type TranscriptQualityLevel = "good" | "poor" | "none";

export interface TranscriptQuality {
  level: TranscriptQualityLevel;
  /** Candidate turns that carried any words. */
  answers: number;
  totalWords: number;
  medianAnswerWords: number | null;
  /** Human-readable threshold that decided the level, for the report note. */
  reason: string | null;
}

/** Below this much candidate speech there is no interview at all. */
const NONE_TOTAL_WORDS = 25;
/** A real interview has at least this many distinct answers. */
const MIN_ANSWERS = 3;
/**
 * Expected candidate speech in words per minute of booked interview time.
 * Real 2-minute tests measure roughly 40-80; well under half of that is a
 * transcript too thin to justify paid analysis.
 */
const MIN_WORDS_PER_MINUTE = 20;

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function assessTranscriptQuality(
  turns: readonly InterviewTurn[],
  durationMinutes: number,
): TranscriptQuality {
  const candidateTurns = turns
    .filter((turn) => turn.speaker === "candidate")
    .map((turn) => words(turn.text))
    .filter((count) => count > 0);
  const answers = candidateTurns.length;
  const totalWords = candidateTurns.reduce((sum, count) => sum + count, 0);
  const medianAnswerWords = median(candidateTurns);

  if (totalWords < NONE_TOTAL_WORDS || answers < 2) {
    return {
      level: "none",
      answers,
      totalWords,
      medianAnswerWords,
      reason:
        "The candidate barely spoke during the interview, so there is no usable transcript to analyse.",
    };
  }
  const expectedWords = Math.max(1, durationMinutes) * MIN_WORDS_PER_MINUTE;
  if (totalWords < expectedWords || answers < MIN_ANSWERS) {
    return {
      level: "poor",
      answers,
      totalWords,
      medianAnswerWords,
      reason: `Thin transcript: ${answers} answer${answers === 1 ? "" : "s"}, ${totalWords} words across ${durationMinutes} booked minutes (about ${expectedWords} expected).`,
    };
  }
  return { level: "good", answers, totalWords, medianAnswerWords, reason: null };
}
/**
 * Rough per-step model costs for the analyses that can be skipped, in US
 * dollars. These are estimates for the savings note in the report — the
 * actual bill varies with answer length and frame counts.
 */
export const SKIPPED_ANALYSIS_COSTS = {
  video: 0.03,
  secondGrader: 0.01,
  resumeCheck: 0.01,
  authenticityCheck: 0.01,
} as const;

export interface SkippedAnalyses {
  skipped: string[];
  estimatedUsd: number;
}

/** What a thin transcript lets us skip, and what that is roughly worth. */
export function skippedAnalysesFor(quality: TranscriptQuality): SkippedAnalyses {
  if (quality.level === "good") return { skipped: [], estimatedUsd: 0 };
  const skipped = [
    "Recording frame analysis",
    "Independent second grading",
    ...(quality.totalWords > 0 ? ["Resume claim check", "Answer-authenticity check"] : []),
  ];
  const estimatedUsd =
    SKIPPED_ANALYSIS_COSTS.video +
    SKIPPED_ANALYSIS_COSTS.secondGrader +
    SKIPPED_ANALYSIS_COSTS.resumeCheck +
    SKIPPED_ANALYSIS_COSTS.authenticityCheck;
  return { skipped, estimatedUsd: Math.round(estimatedUsd * 100) / 100 };
}