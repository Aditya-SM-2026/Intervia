/**
 * The automatic resume filter.
 *
 * A candidate is swept up only when both halves of the rule are true:
 *
 *   Match score below the Match limit  AND  CGPA below the CGPA limit
 *
 * The two limits are per role and HR edits them on the role page; 50 and 6 are
 * only the starting point. One low number on its own is not enough. A fresher
 * with no CGPA on the form is never swept up either, because "unknown" is not
 * "below 6": the recruiter still sees them. Nothing here deletes anything by
 * itself; it only produces the list the recruiter reviews, ticks and deletes.
 */

export interface AutoFilterRule {
  /** A Match score must be strictly below this to be filtered. */
  matchBelow: number;
  /** A CGPA must be strictly below this to be filtered. */
  cgpaBelow: number;
}

/** What a role starts at until HR changes it. */
export const DEFAULT_AUTO_FILTER_RULE: AutoFilterRule = { matchBelow: 50, cgpaBelow: 6 };

function clampNumber(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), max);
}

/** Keeps a saved rule usable: whole Match percent, one decimal of CGPA. */
export function sanitizeAutoFilterRule(input: unknown): AutoFilterRule {
  const source = (input ?? {}) as Partial<Record<keyof AutoFilterRule, unknown>>;
  const matchBelow = Math.round(
    clampNumber(source.matchBelow, DEFAULT_AUTO_FILTER_RULE.matchBelow, 100),
  );
  const cgpaBelow =
    Math.round(clampNumber(source.cgpaBelow, DEFAULT_AUTO_FILTER_RULE.cgpaBelow, 100) * 10) / 10;
  return { matchBelow, cgpaBelow };
}

export interface AutoFilterInput {
  screeningScore?: number | null;
  candidateCgpa?: number | null;
}

/** True when the candidate matches both halves of the rule. */
export function isAutoFiltered(
  candidate: AutoFilterInput,
  rule: AutoFilterRule = DEFAULT_AUTO_FILTER_RULE,
): boolean {
  const score = candidate.screeningScore;
  const cgpa = candidate.candidateCgpa;
  if (typeof score !== "number" || !Number.isFinite(score)) return false;
  if (typeof cgpa !== "number" || !Number.isFinite(cgpa)) return false;
  return score < rule.matchBelow && cgpa < rule.cgpaBelow;
}

/** "Match below 50 and CGPA below 6", for the dialog's own explanation. */
export function autoFilterRuleText(rule: AutoFilterRule = DEFAULT_AUTO_FILTER_RULE): string {
  return `Match below ${rule.matchBelow} and CGPA below ${rule.cgpaBelow}`;
}
