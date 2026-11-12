/**
 * Shortlisting by resume Match score.
 *
 * Two things decide it, in this order:
 *  1. A recruiter's manual tick on one candidate, which wins both ways: they
 *     can shortlist someone below the cutoff, or drop someone above it.
 *  2. The role's cutoff, a number set once on the role page.
 *
 * Nothing here rejects an application. A status is shown beside the score so a
 * recruiter can sort and filter; the decision to reject stays theirs.
 */

export type ShortlistStatus = "shortlisted" | "below_cutoff" | "not_scored";

/**
 * What a role starts at: a 70% Match score shortlists. HR edits the number on
 * the role page, and 0 still means "do not shortlist automatically".
 */
export const DEFAULT_SHORTLIST_CUTOFF = 70;

/** Cutoffs live between 0 and 100; 0 means "no cutoff set". */
export function clampCutoff(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.min(100, rounded);
}

/** Where one candidate stands, given their manual tick, score and the cutoff. */
export function shortlistStatusFor(
  manual: boolean | null | undefined,
  score: number | null | undefined,
  cutoff: number,
): ShortlistStatus {
  if (manual === true) return "shortlisted";
  if (manual === false) return "below_cutoff";
  if (score === null || score === undefined) return "not_scored";
  if (clampCutoff(cutoff) === 0) return "not_scored";
  return score >= clampCutoff(cutoff) ? "shortlisted" : "below_cutoff";
}

/** Human label for the table chip. */
export const SHORTLIST_LABELS: Record<ShortlistStatus, string> = {
  shortlisted: "Shortlisted",
  below_cutoff: "Below cutoff",
  not_scored: "Not scored",
};

/** True when the row should come through a "shortlisted only" filter. */
export function passesShortlistFilter(
  status: ShortlistStatus | null | undefined,
  onlyShortlisted: boolean,
): boolean {
  if (!onlyShortlisted) return true;
  return status === "shortlisted";
}

/**
 * True when a candidate's CGPA clears a minimum. A blank CGPA never passes a
 * minimum, because unknown is not the same as good enough.
 */
export function passesCgpaFilter(cgpa: number | null | undefined, minimum: number): boolean {
  if (!Number.isFinite(minimum) || minimum <= 0) return true;
  if (cgpa === null || cgpa === undefined || !Number.isFinite(cgpa)) return false;
  return cgpa >= minimum;
}

/** "B.Tech · 8.4" for the table cell, or null when the candidate gave nothing. */
export function educationLabel(
  education: string | null | undefined,
  cgpa: number | null | undefined,
): string | null {
  const parts = [
    education?.trim() ? education.trim() : null,
    cgpa === null || cgpa === undefined || !Number.isFinite(cgpa) ? null : `CGPA ${cgpa}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}
