import "server-only";

/**
 * Brute-force guard for the candidate email gate, per link. Kept in memory
 * (single web instance for now); database-backed counters can replace this
 * when the web service scales out.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60_000;

interface AttemptState {
  failures: number;
  lockedUntil: number;
}

const globalAttempts = globalThis as unknown as {
  __interviewEmailAttempts?: Map<string, AttemptState>;
};

function getAttempts(): Map<string, AttemptState> {
  if (!globalAttempts.__interviewEmailAttempts) {
    globalAttempts.__interviewEmailAttempts = new Map();
  }
  return globalAttempts.__interviewEmailAttempts;
}

/** Returns whether another verification attempt may be made right now. */
export function checkEmailAttempt(roomId: string): { allowed: boolean; retryAfterSeconds?: number } {
  const state = getAttempts().get(roomId);
  if (!state) return { allowed: true };
  const remaining = state.lockedUntil - Date.now();
  if (remaining <= 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

/** Counts a failed verification; locks the link after too many. */
export function recordEmailFailure(roomId: string): void {
  const attempts = getAttempts();
  const state = attempts.get(roomId) ?? { failures: 0, lockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCK_DURATION_MS;
    state.failures = 0;
  }
  attempts.set(roomId, state);
}

/** Clears the counter after a successful verification. */
export function resetEmailAttempts(roomId: string): void {
  getAttempts().delete(roomId);
}