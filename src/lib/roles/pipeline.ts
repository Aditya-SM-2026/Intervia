import type { HireStage } from "./hire-stage";

/**
 * The five steps a recruiter scans for a role, folded from the detailed
 * hire stages. Used for the pipeline bars on the roles pages.
 */
export type PipelineStep = "applied" | "interviewing" | "scored" | "advanced" | "closed";

export const PIPELINE_STEPS: { step: PipelineStep; label: string; bar: string; dot: string }[] = [
  { step: "applied", label: "Applied", bar: "bg-foreground/25", dot: "bg-foreground/30" },
  { step: "interviewing", label: "Interviewing", bar: "bg-accent/45", dot: "bg-accent/50" },
  { step: "scored", label: "Scored", bar: "bg-accent", dot: "bg-accent" },
  { step: "advanced", label: "Advanced", bar: "bg-gold", dot: "bg-gold" },
  { step: "closed", label: "Rejected or dropped", bar: "bg-rose-400/60", dot: "bg-rose-400/70" },
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
export function scoreTone(score: number): { text: string; bar: string } {
  if (score >= 70) return { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" };
  if (score >= 50) return { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" };
  return { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500" };
}
