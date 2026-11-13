/**
 * Automatic interview invitations for candidates whose resume screening score
 * clears the role's bar.
 *
 * Kept free of database and server imports so the numbers the settings screen
 * saves and the numbers the sender compares are the same, and can be tested.
 */

export type AutoInviteDifficulty = "easy" | "medium" | "hard" | "extra-hard";

export interface AutoInviteSettings {
  /** Off by default: nothing is sent until HR switches it on. */
  enabled: boolean;
  /** The Match score a candidate must reach, 1-100. */
  threshold: number;
  durationMinutes: number;
  difficulty: AutoInviteDifficulty;
  /** Optional copy of every invitation, for an HR mailbox. */
  hrEmail: string | null;
}

export const AUTO_INVITE_DIFFICULTIES: readonly AutoInviteDifficulty[] = [
  "easy",
  "medium",
  "hard",
  "extra-hard",
];

/** The bar the requirement names: a Match score of 70. */
export const DEFAULT_AUTO_INVITE_THRESHOLD = 70;

export const DEFAULT_AUTO_INVITE_SETTINGS: AutoInviteSettings = {
  enabled: false,
  threshold: DEFAULT_AUTO_INVITE_THRESHOLD,
  durationMinutes: 30,
  difficulty: "medium",
  hrEmail: null,
};

/** Allowed interview lengths, matching the interview form's own limits. */
export const AUTO_INVITE_MIN_DURATION = 2;
export const AUTO_INVITE_MAX_DURATION = 45;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAutoInviteEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Turns stored or posted settings into usable ones. Unknown values fall back
 * to the defaults rather than throwing, so an old role record never blocks the
 * settings screen.
 */
export function sanitizeAutoInviteSettings(input: unknown): AutoInviteSettings {
  const source = (input ?? {}) as Record<string, unknown>;
  const difficulty = AUTO_INVITE_DIFFICULTIES.includes(source.difficulty as AutoInviteDifficulty)
    ? (source.difficulty as AutoInviteDifficulty)
    : DEFAULT_AUTO_INVITE_SETTINGS.difficulty;
  const email = typeof source.hrEmail === "string" ? source.hrEmail.trim().toLowerCase() : "";
  return {
    enabled: source.enabled === true,
    threshold: clampInt(source.threshold, 1, 100, DEFAULT_AUTO_INVITE_SETTINGS.threshold),
    durationMinutes: clampInt(
      source.durationMinutes,
      AUTO_INVITE_MIN_DURATION,
      AUTO_INVITE_MAX_DURATION,
      DEFAULT_AUTO_INVITE_SETTINGS.durationMinutes,
    ),
    difficulty,
    hrEmail: email !== "" && EMAIL_PATTERN.test(email) ? email : null,
  };
}

/** True when a scored candidate clears the role's bar. */
export function clearsAutoInviteBar(
  score: number | null | undefined,
  threshold: number,
): boolean {
  if (score === null || score === undefined || !Number.isFinite(score)) return false;
  return Math.round(score) >= Math.round(threshold);
}
