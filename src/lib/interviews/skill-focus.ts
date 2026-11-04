/**
 * Custom scoring: the skills a recruiter wants weighted in an interview.
 *
 * Each entry is one custom parameter (a skill from the role, or one added by
 * hand such as "Kubernetes" or "Communication"). The weight is a relative
 * emphasis for question planning, 0-100, where 50 is the neutral default.
 * It never restricts the interview to those topics: the plan may still ask
 * about other things the role needs.
 *
 * The same list is what the post-interview scorecard evaluates against the
 * resume and the candidate's answers.
 *
 * Pure module (no server-only imports): the form, the plan generator, the
 * scorecard and the tests all share it.
 */

export interface SkillFocus {
  /** The skill or parameter name, as the recruiter sees it. */
  skill: string;
  /** 0-100 relative emphasis; 50 is normal and 0 means "barely probe this". */
  weight: number;
}

/** The neutral weight: the interviewer decides the balance itself. */
export const DEFAULT_SKILL_WEIGHT = 50;
export const MIN_SKILL_WEIGHT = 0;
export const MAX_SKILL_WEIGHT = 100;
/** Matches the roles module's own limit on skills. */
export const MAX_SKILL_FOCUS = 30;
export const MAX_SKILL_NAME_LENGTH = 80;

function clampWeight(value: number): number {
  return Math.max(MIN_SKILL_WEIGHT, Math.min(MAX_SKILL_WEIGHT, Math.round(value)));
}

/**
 * Cleans a list from the form or an API payload: trims names, drops blanks,
 * removes case-insensitive duplicates (keeping the first), and clamps the
 * weight. Never throws; malformed entries are simply left out.
 */
export function normalizeSkillFocus(input: unknown): SkillFocus[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const cleaned: SkillFocus[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { skill?: unknown; weight?: unknown };
    const skill = typeof item.skill === "string" ? item.skill.trim() : "";
    if (!skill || skill.length > MAX_SKILL_NAME_LENGTH) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    const parsedWeight = Number(item.weight);
    seen.add(key);
    cleaned.push({
      skill,
      weight: Number.isFinite(parsedWeight) ? clampWeight(parsedWeight) : DEFAULT_SKILL_WEIGHT,
    });
    if (cleaned.length >= MAX_SKILL_FOCUS) break;
  }
  return cleaned;
}

/** True when at least one weight was moved off the neutral default. */
export function hasCustomWeights(focus: readonly SkillFocus[]): boolean {
  return focus.some((item) => item.weight !== DEFAULT_SKILL_WEIGHT);
}

/** Weights normalised to percentages that add up to 100 (equal when all are 0). */
export function skillFocusPercentages(
  focus: readonly SkillFocus[],
): { skill: string; weight: number; percent: number }[] {
  if (focus.length === 0) return [];
  const total = focus.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const even = Math.round(100 / focus.length);
  return focus.map((item) => ({
    skill: item.skill,
    weight: item.weight,
    percent:
      total === 0 ? even : Math.round((Math.max(0, item.weight) / total) * 100),
  }));
}

/** The focus entry that matches a plan competency's skill, case-insensitively. */
export function findSkillFocus(
  focus: readonly SkillFocus[] | undefined,
  skill: string | null | undefined,
): SkillFocus | null {
  if (!focus || focus.length === 0) return null;
  const wanted = skill?.trim().toLowerCase();
  if (!wanted) return null;
  return focus.find((item) => item.skill.toLowerCase() === wanted) ?? null;
}
