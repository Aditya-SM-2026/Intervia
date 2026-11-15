import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logActivity } from "@/lib/activity/activity";
import { passwordProblem } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

/**
 * A team member changes their own password. Their other sessions end; this
 * one stays signed in. The admin login's password is set on the server.
 */
export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } }, { status: 401 });
  if (actor.role === "owner") {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "The admin password is set on the server, not here." } }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { current?: unknown; next?: unknown };
  const repository = getAccountsRepository();
  const member = await repository.getMember(actor.id);
  if (!member || typeof body.current !== "string" || !(await verifyPassword(body.current, member.passwordHash))) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Your current password is not right.", fields: { current: "Not right." } } }, { status: 400 });
  }
  const problem = passwordProblem(body.next);
  if (problem) return NextResponse.json({ error: { code: "INVALID_INPUT", message: problem, fields: { next: problem } } }, { status: 400 });
  await repository.updateMember(actor.id, { passwordHash: await hashPassword(body.next as string) });
  const ended = await repository.revokeSessionsFor(actor.id, actor.sessionId ?? undefined);
  await logActivity({ action: "team.password_changed", targetType: "member", targetId: actor.id, summary: `${actor.name} changed their password`, actor, details: ended ? { otherSessionsEnded: ended } : undefined });
  return NextResponse.json({ ok: true });
}
