import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logActivity } from "@/lib/activity/activity";
import { passwordProblem } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";
import { publicMember } from "@/lib/team/public-member";

type RouteParams = { params: Promise<{ memberId: string }> };

/**
 * Changes one member (admin only): rename, turn the account off or on, or set
 * a new password. Turning off or resetting the password ends every session
 * that person has, so it takes effect at once on all their devices.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { memberId } = await params;
  const repository = getAccountsRepository();
  const before = await repository.getMember(memberId);
  if (!before) return NextResponse.json({ error: { code: "NOT_FOUND", message: "This person is not on the team." } }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; active?: unknown; password?: unknown };
  const patch: { name?: string; active?: boolean; passwordHash?: string } = {};
  const changes: string[] = [];
  if (typeof body.name === "string") {
    const name = body.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Enter their name.", fields: { name: "Enter their name." } } }, { status: 400 });
    }
    if (name !== before.name) { patch.name = name; changes.push(`renamed to ${name}`); }
  }
  if (typeof body.active === "boolean" && body.active !== before.active) {
    patch.active = body.active;
    changes.push(body.active ? "turned the account on" : "turned the account off");
  }
  if (body.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: { code: "INVALID_INPUT", message: problem, fields: { password: problem } } }, { status: 400 });
    patch.passwordHash = await hashPassword(body.password as string);
    changes.push("set a new password");
  }
  const member = await repository.updateMember(memberId, patch);
  if (!member) return NextResponse.json({ error: { code: "NOT_FOUND", message: "This person is not on the team." } }, { status: 404 });
  const signedOut = patch.active === false || patch.passwordHash ? await repository.revokeSessionsFor(memberId) : 0;
  if (changes.length > 0) {
    await logActivity({
      action: patch.active === false ? "team.member_turned_off" : patch.active === true ? "team.member_turned_on" : patch.passwordHash ? "team.password_reset" : "team.member_renamed",
      targetType: "member",
      targetId: memberId,
      summary: `${before.name}: ${changes.join(", ")}`,
      details: signedOut ? { sessionsEnded: signedOut } : undefined,
      actor: await getActor(),
    });
  }
  return NextResponse.json({ member: publicMember(member), sessionsEnded: signedOut });
}
