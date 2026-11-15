import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/activity";
import { getActor } from "@/lib/auth/actor";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

/** Ends this session for good: the cookie stops working everywhere, not just here. */
export async function POST() {
  const actor = await getActor();
  if (actor?.sessionId) {
    await getAccountsRepository().revokeSession(actor.sessionId).catch(() => undefined);
    await logActivity({ action: "auth.signed_out", summary: `${actor.name} signed out`, actor });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
