import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getAuthMode,
  isPasswordCorrect,
  isUsernameCorrect,
} from "@/lib/auth/session";

const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;

interface Attempts {
  failures: number;
  lockedUntil: number;
}
const globalAttempts = globalThis as unknown as { __loginAttempts?: Map<string, Attempts> };
const attempts = globalAttempts.__loginAttempts ?? (globalAttempts.__loginAttempts = new Map());

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status });
}

/** Recruiter sign-in: exchanges the shared password for a session cookie. */
export async function POST(request: NextRequest) {
  const mode = getAuthMode();
  if (mode === "open") return NextResponse.json({ ok: true });
  if (mode === "locked") {
    return failure("Sign-in is not configured. Set RECRUITER_PASSWORD on the server.", 503);
  }

  const key = clientKey(request);
  const state = attempts.get(key);
  if (state && state.lockedUntil > Date.now()) {
    return failure("Too many attempts. Try again in a few minutes.", 429);
  }

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") username = body.username;
    if (typeof body.password === "string") password = body.password;
  } catch {
    // Treated as a wrong password below.
  }

  // Both checks run before any branch so a wrong login ID and a wrong
  // password are indistinguishable in timing and response.
  const usernameOk = await isUsernameCorrect(username);
  const passwordOk = await isPasswordCorrect(password);
  if (!usernameOk || !passwordOk) {
    const next = state ?? { failures: 0, lockedUntil: 0 };
    next.failures += 1;
    if (next.failures >= MAX_FAILURES) {
      next.failures = 0;
      next.lockedUntil = Date.now() + LOCK_MS;
    }
    attempts.set(key, next);
    return failure("Incorrect login ID or password.", 401);
  }

  attempts.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
