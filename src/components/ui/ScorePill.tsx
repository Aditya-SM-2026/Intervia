/**
 * The one way a 0 to 100 score is shown in lists: a small tinted pill.
 * Green from 70, amber from 50, soft rose below. No bar next to it: the
 * number and its tint already say it, and a column of red bars reads as an
 * error log.
 */
export function scorePillTone(score: number): string {
  if (score >= 70) return "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300";
  if (score >= 50) return "bg-amber-500/14 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300";
  return "bg-rose-500/10 text-rose-700 dark:bg-rose-400/12 dark:text-rose-300";
}

export function ScorePill({ score, size = "md", className = "" }: { score: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizing =
    size === "lg" ? "h-8 min-w-11 px-2.5 text-base" : size === "sm" ? "h-5 min-w-8 px-1.5 text-[11px]" : "h-6 min-w-9 px-2 text-xs";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-semibold tabular-nums ${sizing} ${scorePillTone(score)} ${className}`}
      aria-label={`Score ${score} of 100`}
    >
      {score}
    </span>
  );
}
