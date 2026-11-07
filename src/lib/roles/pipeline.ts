import type { HireStage } from "./hire-stage";

/**
 * The five steps a recruiter scans for a role, folded from the detailed
 * hire stages. Used for the pipeline bars on the roles pages.
 */
export type PipelineStep = "applied" | "interviewing" | "scored" | "advanced" | "closed";

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
    step: "interviewing",
    label: "Interviewing",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    tile: "bg-sky-500/[0.08] text-sky-700 dark:text-sky-300",
  },
  {
    step: "scored",
    label: "Scored",
    bar: "bg-accent",
    dot: "bg-accent",
    tile: "bg-accent/[0.08] text-accent",
  },
  {
    step: "advanced",
    label: "Advanced",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    tile: "bg-emerald-500/[0.09] text-emerald-700 dark:text-emerald-300",
  },
  {
    step: "closed",
    label: "Rejected or dropped",
    bar: "bg-rose-400",
    dot: "bg-rose-400",
    tile: "bg-rose-500/[0.07] text-rose-700 dark:text-rose-300",
  },
];

export function pipelineStep(stage: HireStage, interviewed: boolean): PipelineStep {
  if (stage === "advanced") return "advanced";
  if (stage === "rejected" || stage === "dropped-out") return "closed";
  if (!interviewed) return "applied";
  if (stage === "completed" || stage === "ready-to-advance" || stage === "on-hold") return "scored";
  return "interviewing";
}

export function countPipeline(
  rows: { stage: HireStage; interviewed: boolean }[],
): Record<PipelineStep, number> {
  const counts: Record<PipelineStep, number> = { applied: 0, interviewing: 0, scored: 0, advanced: 0, closed: 0 };
  for (const row of rows) counts[pipelineStep(row.stage, row.interviewed)] += 1;
  return counts;
}

/** Score colour used across the roles pages: green, amber or rose. */
export function scoreTone(score: number): { text: string; bar: string; stroke: string } {
  if (score >= 70) return { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", stroke: "stroke-emerald-500" };
  if (score >= 50) return { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", stroke: "stroke-amber-500" };
  return { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", stroke: "stroke-rose-500" };
}
