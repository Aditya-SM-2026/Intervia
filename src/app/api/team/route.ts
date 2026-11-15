import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logActivity } from "@/lib/activity/activity";
import { validateNewMember } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { expectedUsername } from "@/lib/auth/session";
import { publicMember } from "@/lib/team/public-member";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

/** The team (admin only). */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const members = await getAccountsRepository().listMembers();
  return NextResponse.json({ members: members.map(publicMember) });
}

/** Adds a team member with a starting password the admin shares with them. */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const checked = validateNewMember(body, expectedUsername());
  if (!checked.ok) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Check the highlighted fields.", fields: checked.errors } }, { status: 400 });
  }
  const actor = await getActor();
  const member = await getAccountsRepository().createMember({
    name: checked.value.name,
    email: checked.value.email,
    passwordHash: await hashPassword(checked.value.password),
    createdBy: actor?.id ?? "owner",
  });
  if (!member) {
    return NextResponse.json({ error: { code: "DUPLICATE", message: "Someone on the team already uses this email.", fields: { email: "Already on the team." } } }, { status: 409 });
  }
  await logActivity({ action: "team.member_added", targetType: "member", targetId: member.id, summary: `Added ${member.name} (${member.email}) to the team`, actor });
  return NextResponse.json({ member: publicMember(member) }, { status: 201 });
}
