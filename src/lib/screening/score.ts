/**
 * Weighted totals for resume screening.
 *
 * Rules, matching what was agreed:
 * 1. A section weighted 0 is ignored for everyone.
 * 2. A section that could not be scored is left out of numerator and
 *    denominator, so its weight is shared by the sections that remain. A
 *    fresher without certifications is not marked down for having none.
 * 3. If nothing that remains is scored, the total is null rather than 0.
 * 4. If every remaining weight is 0, fall back to an equal mean.
 */

import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_IDS,
  type ResumeSectionId,
  type ScreeningTotals,
  type ScreeningWeights,
  type SectionResult,
} from "./types.ts";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/** Percentages as whole numbers between 0 and 100; anything odd falls back. */
export function sanitizeWeights(input: unknown): ScreeningWeights {
  const source = (input ?? {}) as Record<string, unknown>;
  const clean = { ...DEFAULT_SCREENING_WEIGHTS };
  for (const id of RESUME_SECTION_IDS) {
    const value = source[id];
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[id] = Math.round(clamp(value));
    }
  }
  return clean;
}

export function weightsTotal(weights: ScreeningWeights): number {
  return RESUME_SECTION_IDS.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0);
}

/** True when the weights are usable as a whole; the editor blocks saving otherwise. */
export function weightsAreValid(weights: ScreeningWeights): boolean {
  return weightsTotal(weights) === 100;
}

/** The section ids that carry weight for this role, in display order. */
export function weightedSectionIds(weights: ScreeningWeights): ResumeSectionId[] {
  return RESUME_SECTION_IDS.filter((id) => (weights[id] ?? 0) > 0);
}

/**
 * The weighted total. `weights` is the role's live setting, so changing it
 * recomputes from the stored section scores with no model call.
 */
export function screeningTotal(
  sections: readonly SectionResult[],
  weights: ScreeningWeights,
): ScreeningTotals {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const counted = weightedSectionIds(weights);
  // With every weight at 0 there is no ranking to respect: fall back to a plain
  // mean over whatever was scored, rather than showing nothing.
  const considered = counted.length > 0 ? counted : [...RESUME_SECTION_IDS];
  const scored = considered
    .map((id) => byId.get(id))
    .filter(
      (section): section is SectionResult =>
        section !== undefined && section.status === "scored" && section.score !== null,
    );

  if (scored.length === 0) {
    return { score: null, scoredSections: 0, weightedSections: counted.length };
  }

  const totalWeight = scored.reduce((sum, section) => sum + (weights[section.id] ?? 0), 0);
  if (totalWeight <= 0) {
    const mean = scored.reduce((sum, section) => sum + (section.score as number), 0) / scored.length;
    return {
      score: clamp(mean),
      scoredSections: scored.length,
      weightedSections: counted.length === 0 ? scored.length : counted.length,
    };
  }

  const total = scored.reduce(
    (sum, section) => sum + (section.score as number) * (weights[section.id] ?? 0),
    0,
  );
  return {
    score: clamp(total / totalWeight),
    scoredSections: scored.length,
    weightedSections: counted.length,
  };
}

/** "scored on 5 of 6 sections" needs the ratio, not just the count. */
export function sectionCoverage(totals: ScreeningTotals): string {
  if (totals.weightedSections === 0) return "no sections weighted";
  return `scored on ${totals.scoredSections} of ${totals.weightedSections} sections`;
}
