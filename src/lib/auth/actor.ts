import "server-only";
import { cookies, headers } from "next/headers";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";
import { OWNER_ID, clientAddress, type Actor } from "./accounts.logic";
import { SESSION_COOKIE, accountDisplayName, getAuthMode, sessionIdFromCookie } from "./session";

export type { Actor } from "./accounts.logic";

/** The owner as an actor (the deployment's admin login). */
export function ownerActor(sessionId: string | null): Actor {
  return { id: OWNER_ID, name: accountDisplayName(), email: null, role: "owner", sessionId };
}

/**
 * Who a session cookie belongs to, or null. The session must exist, be
 * neither ended nor expired, and a member's account must still be on: signing
 * out or turning an account off takes effect on the very next request.
 */
export async function actorFromCookieValue(value: string | undefined): Promise<Actor | null> {
  const mode = getAuthMode();
  if (mode === "open") return ownerActor(null);
  if (mode === "locked") return null;
  const sessionId = await sessionIdFromCookie(value);
  if (!sessionId) return null;
  const repository = getAccountsRepository();
  const session = await repository.getSession(sessionId).catch(() => null);
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
  if (session.userId === OWNER_ID) return ownerActor(sessionId);
  const member = await repository.getMember(session.userId).catch(() => null);
  if (!member || !member.active) return null;
  return { id: member.id, name: member.name, email: member.email, role: "member", sessionId };
}

/** The signed-in person for this request (route handlers and server pages). */
export async function getActor(): Promise<Actor | null> {
  const store = await cookies();
  return actorFromCookieValue(store.get(SESSION_COOKIE)?.value);
}

/** The caller's address for the activity log; a client cannot choose it. */
export async function requestAddress(): Promise<string> {
  const list = await headers();
  return clientAddress(list.get("x-forwarded-for"));
}
