import type { RoleCandidateSummary } from "./role.types";
import { CANDIDATE_STATUS_ORDER, INTERVIEW_STATE_ORDER } from "./candidate-status.ts";

export type CandidateSortKey =
  | "candidate"
  | "applied"
  | "interview"
  | "status"
  | "interviewState"
  | "score"
  | "match";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: CandidateSortKey;
  direction: SortDirection;
}

/** A candidate row as the table holds it. */
export interface SortableCandidateRow {
  candidate: RoleCandidateSummary;
}

/** The sortable value of one candidate row, or null when it has none. */
export function candidateSortValue(
  row: SortableCandidateRow,
  key: CandidateSortKey,
): string | number | null {
  const candidate = row.candidate;
  switch (key) {
    case "candidate":
      return (candidate.candidateName ?? candidate.candidateEmail).toLowerCase();
    case "applied":
      return candidate.appliedAt ? Date.parse(candidate.appliedAt) : null;
    case "interview":
      return candidate.scheduledAt
        ? Date.parse(candidate.scheduledAt)
        : candidate.latestInterviewAt
          ? Date.parse(candidate.latestInterviewAt)
          : null;
    case "status": {
      const index = CANDIDATE_STATUS_ORDER.indexOf(candidate.status);
      return index >= 0 ? index : null;
    }
    case "interviewState": {
      const index = INTERVIEW_STATE_ORDER.indexOf(candidate.interviewState);
      return index >= 0 ? index : null;
    }
    case "score":
      return candidate.overallScore;
    case "match":
      return candidate.screeningScore ?? null;
  }
}

/**
 * Ascending or descending comparison. Missing values always sink to the
 * bottom, so an unscored or unapplied candidate never looks like the best or
 * worst, whichever direction the column is in.
 */
export function compareCandidateRows(
  a: SortableCandidateRow,
  b: SortableCandidateRow,
  sort: SortState,
): number {
  const left = candidateSortValue(a, sort.key);
  const right = candidateSortValue(b, sort.key);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));
  return sort.direction === "asc" ? result : -result;
}
