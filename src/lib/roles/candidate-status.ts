/**
 * The six things a candidate can be inside a role.
 *
 *   applied      they submitted the application (and everyone who applied
 *                shows under Applied, whatever else has happened since)
 *   shortlisted  their resume Match score is above 60, or HR ticked them
 *   advanced     they completed the interview
 *   on-hold      HR parked them after seeing the interview score
 *   selected     HR chose them for the role
 *   rejected     the application or the interview outcome was a no
 *
 * Interview progress is deliberately NOT one of these. Where the interview
 * actually is (scheduled, link opened, completed, evaluated, expired) is shown
 * in its own Interview column so the two never get confused.
 */

import type { InterviewStatus } from "@/lib/interviews/interview.types";

export type CandidateStatus =
  | "applied"
  | "shortlisted"
  | "advanced"
  | "on-hold"
  | "selected"
  | "rejected";

/** A resume Match score above this shortlists on its own. */
export const SHORTLIST_SCORE = 60;

/** Read order: the pipeline as HR walks it, rejected last. */
export const CANDIDATE_STATUS_ORDER: readonly CandidateStatus[] = [
  "applied",
  "shortlisted",
  "advanced",
  "on-hold",
  "selected",
  "rejected",
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  advanced: "Advanced",
  "on-hold": "On hold",
  selected: "Selected",
  rejected: "Rejected",
};

export const CANDIDATE_STATUS_STYLES: Record<CandidateStatus, string> = {
  applied: "bg-slate-500/[0.09] text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
  shortlisted: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  advanced: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "on-hold": "bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  selected: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white",
  rejected: "bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
};

export interface CandidateStatusInput {
  /** A recruiter's recorded decision on the latest interview; wins over all. */
  decision: "advance" | "reject" | "hold" | null;
  applicationStatus?: "new" | "scheduled" | "rejected" | null;
  /** The resume Match score, 0-100, or null when the resume is unscored. */
  screeningScore?: number | null;
  /** HR's manual shortlist tick: true shortlists, false holds back. */
  manualShortlist?: boolean | null;
  /** Where the latest interview really is, after expiry is applied. */
  interviewState?: InterviewState | null;
}

/** The six-status pipeline. A human decision always wins. */
export function deriveCandidateStatus(input: CandidateStatusInput): CandidateStatus {
  if (input.decision === "advance") return "selected";
  if (input.decision === "reject") return "rejected";
  if (input.decision === "hold") return "on-hold";
  if (input.applicationStatus === "rejected") return "rejected";
  if (
    input.interviewState === "completed" ||
    input.interviewState === "evaluated"
  ) {
    return "advanced";
  }
  const score = input.screeningScore;
  const scoreShortlists =
    typeof score === "number" && Number.isFinite(score) && score > SHORTLIST_SCORE;
  if (input.manualShortlist === true || (input.manualShortlist !== false && scoreShortlists)) {
    return "shortlisted";
  }
  return "applied";
}

/** Sort the list the way HR reads it: applied first, rejected last. */
export function compareByCandidateStatus(
  a: CandidateStatus,
  b: CandidateStatus,
): number {
  return CANDIDATE_STATUS_ORDER.indexOf(a) - CANDIDATE_STATUS_ORDER.indexOf(b);
}

/* -------------------------------------------------------------------------- */
/* Interview progress, kept apart from the pipeline status                    */
/* -------------------------------------------------------------------------- */

export type InterviewState =
  | "not-scheduled"
  | "scheduled"
  | "link-opened"
  | "in-progress"
  | "completed"
  | "evaluated"
  | "expired"
  | "cancelled";

export const INTERVIEW_STATE_LABELS: Record<InterviewState, string> = {
  "not-scheduled": "Not scheduled",
  scheduled: "Scheduled",
  "link-opened": "Link opened",
  "in-progress": "In progress",
  completed: "Completed",
  evaluated: "Evaluated",
  expired: "Link expired",
  cancelled: "Cancelled",
};

export const INTERVIEW_STATE_STYLES: Record<InterviewState, string> = {
  "not-scheduled": "bg-foreground/[0.05] text-muted",
  scheduled: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "link-opened": "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "in-progress": "bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  completed: "bg-foreground/[0.06] text-foreground",
  evaluated: "bg-accent-soft text-accent",
  expired: "bg-foreground/[0.05] text-muted",
  cancelled: "bg-foreground/[0.05] text-muted",
};

/** Order the interview column sorts in: live first, then finished, then dead. */
export const INTERVIEW_STATE_ORDER: readonly InterviewState[] = [
  "in-progress",
  "link-opened",
  "scheduled",
  "evaluated",
  "completed",
  "not-scheduled",
  "expired",
  "cancelled",
];

export interface InterviewStateInput {
  interviews: number;
  /** Raw stored status of the latest interview. */
  status: InterviewStatus;
  /** When the link stops working; null when it has no window. */
  expiresAt?: string | null;
  /** When the interview finished; null until it does. */
  completedAt?: string | null;
  /** Scorecard total, when one exists. */
  overallScore?: number | null;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Where the candidate's latest interview really is.
 *
 * The stored row can still say `active` or `waiting` long after the link's
 * window closed, which is what made people look like they were interviewing
 * for weeks. Expiry is applied here, at read time, so the column tells the
 * truth without waiting for a write.
 */
export function interviewStateFor(input: InterviewStateInput): InterviewState {
  if (input.interviews <= 0) return "not-scheduled";
  const status = input.status;
  if (status === "completed") {
    return input.overallScore === null || input.overallScore === undefined
      ? "completed"
      : "evaluated";
  }
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  const now = input.now ?? Date.now();
  const expired =
    typeof input.expiresAt === "string" &&
    input.expiresAt !== "" &&
    Number.isFinite(Date.parse(input.expiresAt)) &&
    now > Date.parse(input.expiresAt);
  if (expired) return "expired";
  if (status === "active") return "in-progress";
  if (status === "waiting") return "link-opened";
  return "scheduled";
}

/** True only while the interview is genuinely live. */
export function interviewIsLive(state: InterviewState): boolean {
  return state === "in-progress" || state === "link-opened";
}

/**
 * Whether a fresh invitation can be sent to this candidate.
 *
 * Anyone already booked, mid-interview or finished is left out: a second
 * interview would duplicate or interrupt the one they already have. An expired
 * or cancelled link can be replaced.
 */
export function canReceiveInvite(state: InterviewState): boolean {
  return state === "not-scheduled" || state === "expired" || state === "cancelled";
}

