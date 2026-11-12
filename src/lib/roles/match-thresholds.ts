/**
 * HR's own Match and CGPA bar for a role.
 *
 * The recruiter types the numbers she cares about and the same two numbers
 * drive both jobs on the role page: who is worth scheduling, and who is weak
 * enough to remove. There is no built-in cutoff and no default; a blank field
 * simply means that half of the bar is not being used yet.
 *
 * A missing Match score or CGPA never qualifies and is never treated as
 * "below": freshers stay visible and are never swept up silently.
 */

export interface MatchThresholds {
  /** Match score the candidate must reach, 0-100; null when HR left it blank. */
  minMatch: number | null;
  /** CGPA (or percentage) the candidate must reach; null when left blank. */
  minCgpa: number | null;
}

export const EMPTY_THRESHOLDS: MatchThresholds = { minMatch: null, minCgpa: null };

export interface ThresholdCandidate {
  screeningScore?: number | null;
  candidateCgpa?: number | null;
}

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when HR has entered at least one half of the bar. */
export function hasThresholds(thresholds: MatchThresholds): boolean {
  return thresholds.minMatch !== null || thresholds.minCgpa !== null;
}

/** True when a number the recruiter typed is well formed. */
export function clampThreshold(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/**
 * Clears the bar. A candidate qualifies only on the halves HR filled in, and
 * only when every filled-in value is actually present and at or above the bar.
 */
export function meetsThresholds(
  candidate: ThresholdCandidate,
  thresholds: MatchThresholds,
): boolean {
  if (!hasThresholds(thresholds)) return false;
  if (thresholds.minMatch !== null) {
    if (!usable(candidate.screeningScore) || candidate.screeningScore < thresholds.minMatch) {
      return false;
    }
  }
  if (thresholds.minCgpa !== null) {
    if (!usable(candidate.candidateCgpa) || candidate.candidateCgpa < thresholds.minCgpa) {
      return false;
    }
  }
  return true;
}

/**
 * The other side of the bar: a known value that falls short.
 *
 * Both numbers HR typed must exist on the candidate, and at least one must be
 * below the bar. A missing value is never "below", so it can never be deleted
 * by accident.
 */
export function fallsBelowThresholds(
  candidate: ThresholdCandidate,
  thresholds: MatchThresholds,
): boolean {
  if (!hasThresholds(thresholds)) return false;
  const score = candidate.screeningScore;
  const cgpa = candidate.candidateCgpa;
  if (thresholds.minMatch !== null && !usable(score)) return false;
  if (thresholds.minCgpa !== null && !usable(cgpa)) return false;
  if (thresholds.minMatch !== null && usable(score) && score < thresholds.minMatch) return true;
  if (thresholds.minCgpa !== null && usable(cgpa) && cgpa < thresholds.minCgpa) return true;
  return false;
}

/** "Match ≥ 60 · CGPA ≥ 7", for chips and confirmations. */
export function thresholdLabel(thresholds: MatchThresholds): string {
  const parts: string[] = [];
  if (thresholds.minMatch !== null) parts.push(`Match ≥ ${thresholds.minMatch}`);
  if (thresholds.minCgpa !== null) parts.push(`CGPA ≥ ${thresholds.minCgpa}`);
  return parts.length > 0 ? parts.join(" · ") : "No bar set";
}
