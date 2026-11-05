import type { HumanDecision, InterviewStatus } from "@/lib/interviews/interview.types";

/**
 * HR-friendly hiring stages, derived from real interview state. The product's
 * internals (statuses, scorecards, decisions) collapse into one word the
 * recruiter can act on. Derivation only — nothing here invents state.
 */

export type HireStage =
  | "not-started"
  | "waiting"
  | "in-progress"
  | "awaiting-analysis"
  | "completed"
  | "ready-to-advance"
  | "advanced"
  | "on-hold"
  | "rejected"
  | "dropped-out";

export const HIRE_STAGE_ORDER: readonly HireStage[] = [
  "advanced",
  "ready-to-advance",
  "completed",
  "on-hold",
  "awaiting-analysis",
  "in-progress",
  "waiting",
  "not-started",
  "dropped-out",
  "rejected",
];

export const HIRE_STAGE_LABELS: Record<HireStage, string> = {
  "not-started": "Not started",
  waiting: "Waiting",
  "in-progress": "Interview in progress",
  "awaiting-analysis": "Awaiting analysis",
  completed: "Completed",
  "ready-to-advance": "Ready to advance",
  advanced: "Advanced",
  "on-hold": "On hold",
  rejected: "Rejected",
  "dropped-out": "Never joined",
};

export const HIRE_STAGE_STYLES: Record<HireStage, string> = {
  "not-started": "bg-border/60 text-muted",
  waiting: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "in-progress": "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "awaiting-analysis": "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  completed: "bg-border text-foreground",
  "ready-to-advance": "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  advanced: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white",
  "on-hold": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  "dropped-out": "bg-border/60 text-muted",
};

export interface HireStageInput {
  status: InterviewStatus;
  /** Overall score of the candidate's latest scored interview; null when unscored. */
  overallScore: number | null;
  /** Outcome of the recruiter's recorded decision, if any. */
  decision: HumanDecision["outcome"] | null;
  /** Recruiter-set shortlist cutoff; scores at or above it read "ready to advance". */
  cutoff?: number | null;
}

/** A human decision always wins — it is the recruiter's final word. */
export function deriveHireStage(input: HireStageInput): HireStage {
  if (input.decision === "advance") return "advanced";
  if (input.decision === "reject") return "rejected";
  if (input.decision === "hold") return "on-hold";

  switch (input.status) {
    case "scheduled":
      return "not-started";
    case "waiting":
    case "active":
      return "in-progress";
    case "expired":
    case "cancelled":
      return "dropped-out";
    case "completed":
      if (input.overallScore === null) return "awaiting-analysis";
      if (input.cutoff != null && input.overallScore >= input.cutoff) return "ready-to-advance";
      return "completed";
    default:
      return "awaiting-analysis";
  }
}

/**
 * Stage for someone who applied through a role's form and has no interview
 * yet. Rejected is the recruiter's own call; everything else is Waiting for
 * an interview to be booked, and once it is booked the interview's own stage
 * takes over.
 */
export function deriveApplicationStage(
  status: "new" | "scheduled" | "rejected",
): HireStage {
  if (status === "rejected") return "rejected";
  return "waiting";
}

/** Sort candidates the way an HR would read a shortlist: best and actionable first. */
export function compareByHirePriority(
  a: { stage: HireStage; overallScore: number | null },
  b: { stage: HireStage; overallScore: number | null },
): number {
  const rankDiff =
    HIRE_STAGE_ORDER.indexOf(a.stage) - HIRE_STAGE_ORDER.indexOf(b.stage);
  if (rankDiff !== 0) return rankDiff;
  const scoreDiff = (b.overallScore ?? -1) - (a.overallScore ?? -1);
  return scoreDiff;
}
