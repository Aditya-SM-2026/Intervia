import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/activity";
import {
  MAX_ACCOUNT_FAILURES,
  OWNER_ID,
  SESSION_TTL_MS,
  afterFailure,
  clientAddress,
  lockStatus,
  normaliseEmail,
  type Actor,
} from "@/lib/auth/accounts.logic";
import { dummyPasswordHash, verifyPassword } from "@/lib/auth/password";
import { ownerActor } from "@/lib/auth/actor";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  accountDisplayName,
  getAuthMode,
  isPasswordCorrect,
  isUsernameCorrect,
  signSessionId,
} from "@/lib/auth/session";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

function failure(message: string, status: number) {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status });
}

/**
 * Sign-in. The admin uses the deployment's login ID and password; team
 * members use their email and the password the admin gave them. Wrong
 * passwords are counted in the database per caller address and per login, so
 * the limit holds on every server instance and a made-up address does not
 * reset it.
 */
export async function POST(request: NextRequest) {
  const mode = getAuthMode();
  if (mode === "open") return NextResponse.json({ ok: true });
  if (mode === "locked") {
    return failure("Sign-in is not configured. Set RECRUITER_PASSWORD on the server.", 503);
  }

  let login = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") login = body.username.trim();
    if (typeof body.password === "string") password = body.password;
  } catch {
    // Treated as a wrong password below.
  }

  const repository = getAccountsRepository();
  const now = Date.now();
  const addressKey = `ip:${clientAddress(request.headers.get("x-forwarded-for"))}`;
  const loginKey = `login:${login.toLowerCase().slice(0, 160)}`;
  const [byAddress, byLogin] = await Promise.all([
    repository.getLoginAttempt(addressKey),
    repository.getLoginAttempt(loginKey),
  ]);
  const lock = [lockStatus(byAddress, now), lockStatus(byLogin, now)].find((status) => status.locked);
  if (lock) {
    const minutes = Math.max(1, Math.ceil(lock.retryAfterSeconds / 60));
    return failure(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
  }

  // The admin login, then a member by email. Both paths do the same work so
  // a wrong login and a wrong password cannot be told apart by timing.
  let actor: Actor | null = null;
  const ownerMatch = (await isUsernameCorrect(login)) && (await isPasswordCorrect(password));
  const member = ownerMatch ? null : await repository.getMemberByEmail(normaliseEmail(login));
  const memberMatch = await verifyPassword(password, member?.passwordHash ?? (await dummyPasswordHash()));
  if (ownerMatch) actor = ownerActor(null);
  else if (member && member.active && memberMatch) {
    actor = { id: member.id, name: member.name, email: member.email, role: "member", sessionId: null };
  }

  if (!actor) {
    await Promise.all([
      repository.saveLoginAttempt(addressKey, afterFailure(byAddress, now)),
      repository.saveLoginAttempt(loginKey, afterFailure(byLogin, now, MAX_ACCOUNT_FAILURES)),
    ]);
    if (login) {
      await logActivity({
        action: "auth.sign_in_failed",
        summary: `Failed sign-in for ${login.slice(0, 80) || "an empty login"}`,
        actor: member ? { id: member.id, name: member.name, email: member.email, role: "member", sessionId: null } : null,
        details: member && !member.active ? { reason: "account turned off" } : undefined,
      });
    }
    return failure(
      member && !member.active && memberMatch ? "This account is turned off. Ask the admin." : "Incorrect login ID or password.",
      401,
    );
  }

  await Promise.all([repository.clearLoginAttempt(addressKey), repository.clearLoginAttempt(loginKey)]);
  const session = await repository.createSession(actor.id, new Date(now + SESSION_TTL_MS));
  if (actor.id !== OWNER_ID) await repository.markSignedIn(actor.id);
  await logActivity({
    action: "auth.signed_in",
    summary: `${actor.id === OWNER_ID ? accountDisplayName() : actor.name} signed in`,
    actor: { ...actor, sessionId: session.id },
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await signSessionId(session.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
