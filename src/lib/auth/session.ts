/**
 * Recruiter session: a signed, expiring cookie. One shared password protects
 * the recruiter pages and the dashboard (RECRUITER_PASSWORD); there are no
 * individual accounts yet.
 *
 * Uses Web Crypto only, so the same code runs in the proxy and in route
 * handlers. No secrets are exported.
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

export async function createSessionToken(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${await hmacHex(`session:${expiresAt}`)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  const expiresAt = Number(expiry);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
  return safeEqual(signature, await hmacHex(`session:${expiresAt}`));
}

export async function isPasswordCorrect(candidate: string): Promise<boolean> {
  const expected = process.env.RECRUITER_PASSWORD?.trim();
  if (!expected) return false;
  // Compare digests so the comparison time does not depend on the password.
  return safeEqual(await hmacHex(`password:${candidate}`), await hmacHex(`password:${expected}`));
}

/** True when a request carrying this cookie value may use recruiter features. */
export async function isRecruiterSession(token: string | undefined): Promise<boolean> {
  const mode = getAuthMode();
  if (mode === "open") return true;
  if (mode === "locked") return false;
  return verifySessionToken(token);
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
