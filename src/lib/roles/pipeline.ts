import type { CandidateStatus } from "./candidate-status";

/**
 * The pipeline a recruiter scans for a role. It is the five candidate
 * statuses and nothing else: interview progress lives in its own column, so
 * there is no "interviewing" or "scored" step to confuse it with.
 */
export type PipelineStep = CandidateStatus;

export const PIPELINE_STEPS: {
  step: PipelineStep;
  label: string;
  bar: string;
  dot: string;
  /** Tinted tile for stage counters and board column headers. */
  tile: string;
}[] = [
  {
    step: "applied",
    label: "Applied",
    bar: "bg-slate-400 dark:bg-slate-500",
    dot: "bg-slate-400",
    tile: "bg-slate-500/[0.07] text-slate-700 dark:text-slate-300",
  },
  {
    step: "shortlisted",
    label: "Shortlisted",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    tile: "bg-emerald-500/[0.09] text-emerald-700 dark:text-emerald-300",
  },
  {
    step: "advanced",
    label: "Advanced",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    tile: "bg-sky-500/[0.09] text-sky-700 dark:text-sky-300",
  },
  {
    step: "on-hold",
    label: "On hold",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    tile: "bg-amber-500/[0.09] text-amber-800 dark:text-amber-300",
  },
  {
    step: "selected",
    label: "Selected",
    bar: "bg-emerald-600",
    dot: "bg-emerald-600",
    tile: "bg-emerald-600 text-white dark:bg-emerald-500",
  },
  {
    step: "rejected",
    label: "Rejected",
    bar: "bg-rose-400",
    dot: "bg-rose-400",
    tile: "bg-rose-500/[0.07] text-rose-700 dark:text-rose-300",
  },
];

/** The step a candidate sits in: their status, in pipeline vocabulary. */
export function pipelineStep(status: CandidateStatus): PipelineStep {
  return status;
}

export function countPipeline(rows: { status: CandidateStatus }[]): Record<PipelineStep, number> {
  const counts: Record<PipelineStep, number> = {
    applied: 0,
    shortlisted: 0,
    advanced: 0,
    "on-hold": 0,
    selected: 0,
    rejected: 0,
  };
  for (const row of rows) counts[pipelineStep(row.status)] += 1;
  return counts;
}

/** Score colour used across the roles pages: green, amber or rose. */
export function scoreTone(score: number): { text: string; bar: string; stroke: string } {
  if (score >= 70) return { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", stroke: "stroke-emerald-500" };
  if (score >= 50) return { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", stroke: "stroke-amber-500" };
  return { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", stroke: "stroke-rose-500" };
}
