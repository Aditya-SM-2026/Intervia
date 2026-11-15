/**
 * Brute-force guard for the candidate email gate, worked out from the failed
 * attempts stored on the interview, so every web instance sees the same count.
 * Pure: the times come in, the decision comes out.
 */

export const EMAIL_FAILURE_EVENT = "email_verify_failed";
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;
export const FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Five wrong emails within 15 minutes lock the link for 15 minutes; the count
 * then starts again. Older mistakes stop counting, so a candidate who typed
 * their email wrong earlier is not locked out by one more slip later.
 */
export function emailLockFrom(
  failureTimes: readonly number[],
  now: number,
): { allowed: boolean; retryAfterSeconds?: number } {
  let recent: number[] = [];
  let lockedUntil = 0;
  for (const at of [...failureTimes].sort((a, b) => a - b)) {
    if (at < lockedUntil) continue; // raced in while locked; not counted
    recent = recent.filter((earlier) => at - earlier < FAILURE_WINDOW_MS);
    recent.push(at);
    if (recent.length >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = at + LOCK_DURATION_MS;
      recent = [];
    }
  }
  const remaining = lockedUntil - now;
  return remaining > 0 ? { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) } : { allowed: true };
}
