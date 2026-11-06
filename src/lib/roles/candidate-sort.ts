import type { InterviewStatus } from "@/lib/interviews/interview.types";
import type { HireStage } from "@/lib/roles/hire-stage";
import type { RoleCandidateSummary } from "@/lib/roles/role.types";

export type CandidateSortKey = "candidate" | "applied" | "interview" | "status" | "score";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: CandidateSortKey;
  direction: SortDirection;
}

/** A candidate row plus the stage it is shown under. */
export interface SortableCandidateRow {
  candidate: RoleCandidateSummary;
  stage: HireStage;
}

/** Display order of interview statuses, earliest stage first. */
export const STATUS_SORT_ORDER: InterviewStatus[] = [
  "scheduled",
  "waiting",
  "active",
  "completed",
  "expired",
  "cancelled",
];

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
      const index = STATUS_SORT_ORDER.indexOf(candidate.latestStatus);
      return index >= 0 ? index : null;
    }
    case "score":
      return candidate.overallScore;
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
