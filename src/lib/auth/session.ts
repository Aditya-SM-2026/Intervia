/**
 * Recruiter session cookie. The cookie carries a session id signed with
 * SESSION_SECRET; the session itself (who, until when, ended or not) lives in
 * the database, see src/lib/auth/actor.ts. The owner signs in with the
 * deployment's admin login (ADMIN_USERNAME + RECRUITER_PASSWORD); team
 * members the owner adds sign in with their email.
 *
 * Uses Web Crypto only. No secrets are exported.
 */

export const SESSION_COOKIE = "intervia_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * "password": sign-in required. "open": no password set outside production,
 * so local development needs no setup. "locked": production without a
 * password refuses access rather than exposing candidate data.
 */
export type AuthMode = "password" | "open" | "locked";

export function getAuthMode(): AuthMode {
  if (process.env.RECRUITER_PASSWORD?.trim()) return "password";
  return process.env.NODE_ENV === "production" ? "locked" : "open";
}

function signingSecret(): string {
  return process.env.SESSION_SECRET?.trim() || `intervia:${process.env.RECRUITER_PASSWORD ?? ""}`;
}

async function hmacHex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison so a mismatch position does not leak. */
function safeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** The cookie value for one stored session: "<id>.<signature>". */
export async function signSessionId(sessionId: string): Promise<string> {
  return `${sessionId}.${await hmacHex(`sid:${sessionId}`)}`;
}

/** The session id in a cookie value, or null when it was not signed by us. */
export async function sessionIdFromCookie(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(sessionId)) return null;
  return safeEqual(signature, await hmacHex(`sid:${sessionId}`)) ? sessionId : null;
}

export async function isPasswordCorrect(candidate: string): Promise<boolean> {
  const expected = process.env.RECRUITER_PASSWORD?.trim();
  if (!expected) return false;
  // Compare digests so the comparison time does not depend on the password.
  return safeEqual(await hmacHex(`password:${candidate}`), await hmacHex(`password:${expected}`));
}

/** The login ID an administrator signs in with. A name, not a secret. */
export function expectedUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || "admin";
}

/**
 * The owner account's display name: ADMIN_DISPLAY_NAME when set, otherwise
 * the login ID ("admin" becomes "Admin"). Team members have their own names;
 * use the signed-in actor (src/lib/auth/actor.ts) wherever a person acted.
 */
export function accountDisplayName(): string {
  const configured = process.env.ADMIN_DISPLAY_NAME?.trim();
  if (configured) return configured;
  const login = expectedUsername();
  return login.charAt(0).toUpperCase() + login.slice(1);
}

/** Length-independent, constant-shape comparison for the login ID too. */
export async function isUsernameCorrect(candidate: string): Promise<boolean> {
  return safeEqual(await hmacHex(`username:${candidate}`), await hmacHex(`username:${expectedUsername()}`));
}

/** Covers the longest interview plus its rejoin window. */
const RECORDING_TOKEN_TTL_SECONDS = 3 * 60 * 60;

/**
 * Lets one verified candidate upload their own recording for one interview.
 * Issued with the join credentials; it grants nothing else.
 */
export async function createRecordingToken(roomId: string, recordingId: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + RECORDING_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${await hmacHex(`recording:${roomId}:${recordingId}:${expiresAt}`)}`;
}

export async function verifyRecordingToken(
  token: string | null | undefined,
  roomId: string,
  recordingId: string,
): Promise<boolean> {
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  const expiresAt = Number(expiry);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
  return safeEqual(signature, await hmacHex(`recording:${roomId}:${recordingId}:${expiresAt}`));
}
