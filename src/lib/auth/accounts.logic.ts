/**
 * Team accounts: the pure rules. The owner is the deployment's admin login
 * (ADMIN_USERNAME + RECRUITER_PASSWORD); everyone else is a member the owner
 * adds in Settings. Members can do everything except manage the team.
 */

export type AccountRole = "owner" | "member";

/** Who is acting, as every check and the activity log see it. */
export interface Actor {
  /** "owner" for the deployment's admin login, else the member's id. */
  id: string;
  name: string;
  email: string | null;
  role: AccountRole;
  sessionId: string | null;
}

export const OWNER_ID = "owner";
export const MIN_PASSWORD_LENGTH = 10;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Sign-in lockout. Counted per caller address (8) and, as a backstop that a
 * stranger cannot use to lock the admin out in seconds, per login (30).
 */
export const MAX_LOGIN_FAILURES = 8;
export const MAX_ACCOUNT_FAILURES = 30;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export function isAdmin(actor: Actor | null): boolean {
  return actor?.role === "owner";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** A problem with a new password, in words for the person typing it. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Use at most 200 characters.";
  if (password.trim() !== password) return "Remove the spaces at the start or end.";
  return null;
}

export interface NewMemberInput {
  name: string;
  email: string;
  password: string;
}

/** Checks the Add person form. One message per field, keyed by field. */
export function validateNewMember(
  input: { name?: unknown; email?: unknown; password?: unknown },
  ownerLogin: string,
): { ok: true; value: NewMemberInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const email = normaliseEmail(input.email);
  if (name.length < 2) errors.name = "Enter their name.";
  else if (name.length > 80) errors.name = "Use at most 80 characters.";
  if (!EMAIL.test(email) || email.length > 160) errors.email = "Enter a valid email address.";
  else if (email === ownerLogin.trim().toLowerCase()) errors.email = "This is the admin login.";
  const problem = passwordProblem(input.password);
  if (problem) errors.password = problem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, email, password: input.password as string } };
}

/**
 * The caller's address. Google's front end appends the address it saw to
 * X-Forwarded-For, so the last entry is the one a client cannot choose; the
 * first entries are whatever the client sent.
 */
export function clientAddress(forwardedFor: string | null): string {
  const parts = (forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? "unknown";
}

export interface LoginAttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

/** Whether a login is locked right now, and for how many more seconds. */
export function lockStatus(state: LoginAttemptState | null, now: number): { locked: boolean; retryAfterSeconds: number } {
  if (!state || state.lockedUntil <= now) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
}

/** The attempt state after one more wrong password. */
export function afterFailure(
  state: LoginAttemptState | null,
  now: number,
  max: number = MAX_LOGIN_FAILURES,
): LoginAttemptState {
  const fresh = !state || now - state.firstFailureAt > LOGIN_FAILURE_WINDOW_MS || state.lockedUntil > 0 && state.lockedUntil <= now;
  const failures = fresh ? 1 : state.failures + 1;
  const firstFailureAt = fresh ? now : state.firstFailureAt;
  return failures >= max
    ? { failures: 0, firstFailureAt: now, lockedUntil: now + LOGIN_LOCK_MS }
    : { failures, firstFailureAt, lockedUntil: 0 };
}

/** Activity entries as the Activity page groups them. */
export const ACTIVITY_GROUPS: Record<string, string> = {
  auth: "Sign-in",
  team: "Team",
  role: "Roles",
  application: "Applications",
  interview: "Interviews",
  decision: "Decisions",
  report: "Reports",
  settings: "Settings",
  export: "Downloads",
};

export function activityGroup(action: string): string {
  return action.split(".")[0] ?? "other";
}
