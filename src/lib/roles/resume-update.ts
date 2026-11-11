/**
 * A candidate's private link for replacing the resume on an application they
 * already sent. The token is issued with the application and kept in the
 * database; it stops working a fixed time after the last upload, so a leaked
 * link cannot be used months later.
 *
 * Pure helpers only: the caller reads and writes the token.
 */

/** Tokens are 24 random bytes, URL-safe: the same shape as a form token. */
export const RESUME_UPDATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

/** How long the replace link keeps working after the last upload. */
export const RESUME_UPDATE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The two timestamps that decide whether the link is still live. */
export interface ResumeUpdateTiming {
  createdAt: string;
  /** When the resume was last replaced; null when it was never replaced. */
  resumeUpdatedAt: string | null;
}

export function isResumeUpdateToken(value: string): boolean {
  return RESUME_UPDATE_TOKEN_PATTERN.test(value);
}

/** The moment the link stops working, counted from the last upload. */
export function resumeUpdateExpiresAt(application: ResumeUpdateTiming): string {
  const started = Date.parse(application.resumeUpdatedAt ?? application.createdAt);
  // A stored timestamp that cannot be read counts as already expired, so a
  // damaged row can never hand out a live link.
  if (!Number.isFinite(started)) return new Date(0).toISOString();
  return new Date(started + RESUME_UPDATE_WINDOW_MS).toISOString();
}

/** True while the candidate may still replace the resume. */
export function isResumeUpdateOpen(
  application: ResumeUpdateTiming,
  now: number = Date.now(),
): boolean {
  return now < Date.parse(resumeUpdateExpiresAt(application));
}

/** Digits only, so "+91 98765 43210" and "9876543210" compare cleanly. */
function phoneDigits(phone: string): string {
  return phone.replace(/\D+/g, "");
}

/**
 * Whether two phone numbers belong to the same person. The same number is
 * often written with and without a country code, so the last ten digits
 * decide it; shorter numbers must match exactly.
 */
export function samePhone(a: string, b: string): boolean {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (left === "" || right === "") return false;
  if (left.length >= 10 && right.length >= 10) {
    return left.slice(-10) === right.slice(-10);
  }
  return left === right;
}
