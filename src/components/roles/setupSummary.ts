/** One line of state a setup panel reports to the role page's collapsed "Hiring setup" bar. */
export interface SetupSummary {
  on: boolean;
  label: string;
}

/** Outer classes of a setup panel: its own card, or a row inside the shared card. */
export function setupSectionClass(grouped: boolean): string {
  return grouped
    ? "scroll-mt-24"
    : "scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.02]";
}
