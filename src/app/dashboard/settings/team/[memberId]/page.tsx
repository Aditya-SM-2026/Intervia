import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActivityLog } from "@/components/settings/ActivityLog";
import {
  MemberWorkTabs,
  type MemberInterview,
  type MemberRole,
  type MemberSelection,
} from "@/components/settings/MemberWorkTabs";
import { AdminOnly, SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { OWNER_ID, isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { accountDisplayName } from "@/lib/auth/session";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import type { ActivityEntry } from "@/server/repositories/accounts-repository";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";
import { getInterviewRepository } from "@/server/repositories";
import { getRolesRepository } from "@/server/repositories/roles-repository";

export const metadata: Metadata = { title: "Team member" };
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ memberId: string }>;
}

function formatDay(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function momentOf(room: InterviewRoom): number {
  return Date.parse(room.scheduledAt ?? room.createdAt);
}

/** Did this decision entry mark people as Selected (advance)? */
function markedSelected(entry: ActivityEntry): boolean {
  const decision = entry.details?.decision;
  if (typeof decision === "string") return decision === "advance";
  // Entries written before the outcome was stored in details.
  return /as advance$/.test(entry.summary);
}

/** One row per role: how many people this person selected and when. */
function selectionsFrom(activity: ActivityEntry[]): MemberSelection[] {
  const byRole = new Map<string, MemberSelection>();
  for (const entry of activity) {
    if (entry.action !== "decision.candidates" || !entry.targetId || !markedSelected(entry)) continue;
    const recorded = Array.isArray(entry.details?.candidates)
      ? entry.details.candidates.filter((id): id is string => typeof id === "string")
      : [];
    const count = recorded.length > 0 ? recorded.length : 1;
    const existing = byRole.get(entry.targetId);
    if (existing) {
      existing.count += count;
      existing.candidates = [...new Set([...existing.candidates, ...recorded])];
      if (Date.parse(entry.at) > Date.parse(existing.at)) existing.at = entry.at;
    } else {
      byRole.set(entry.targetId, {
        roleId: entry.targetId,
        roleTitle: null,
        count,
        candidates: recorded,
        at: entry.at,
      });
    }
  }
  return [...byRole.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** One row per role this person created, newest first. */
function createdRolesFrom(activity: ActivityEntry[]): MemberRole[] {
  const byRole = new Map<string, MemberRole>();
  for (const entry of activity) {
    if (entry.action !== "role.created" || !entry.targetId) continue;
    const existing = byRole.get(entry.targetId);
    if (existing) {
      if (Date.parse(entry.at) > Date.parse(existing.at)) existing.at = entry.at;
    } else {
      byRole.set(entry.targetId, { id: entry.targetId, title: null, at: entry.at });
    }
  }
  return [...byRole.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * One person's work, for the admin: who they are, what they scheduled,
 * completed, selected and built, then everything they did. Admin only.
 */
export default async function TeamMemberPage({ params }: RouteParams) {
  const actor = await getActor();
  if (!isAdmin(actor)) {
    return (
      <>
        <SettingsPageHeader title="Team member" tip="What one person on the team has done." />
        <AdminOnly />
      </>
    );
  }

  const { memberId } = await params;
  const accounts = getAccountsRepository();

  const member =
    memberId === OWNER_ID
      ? {
          id: OWNER_ID,
          name: accountDisplayName(),
          email: null as string | null,
          createdBy: null as string | null,
          createdAt: null as string | null,
        }
      : await accounts.getMember(memberId).then((record) =>
          record
            ? {
                id: record.id,
                name: record.name,
                email: record.email as string | null,
                createdBy: record.createdBy,
                createdAt: record.createdAt as string | null,
              }
            : null,
        );

  if (!member) notFound();

  const addedBy = member.createdBy
    ? member.createdBy === OWNER_ID
      ? accountDisplayName()
      : (await accounts.getMember(member.createdBy))?.name ?? null
    : null;

  const [rooms, activity] = await Promise.all([
    getInterviewRepository().list({ createdBy: member.id, limit: 200 }),
    accounts.listActivity({ actorId: member.id, limit: 200 }),
  ]);

  rooms.sort((a, b) => momentOf(b) - momentOf(a));

  const interviews: MemberInterview[] = rooms.map((room) => ({
    id: room.id,
    candidateName: room.candidateName,
    candidateEmail: room.candidateEmail,
    roleTitle: room.roleTitle,
    scheduledAt: room.scheduledAt,
    status: room.status,
  }));

  const selections = selectionsFrom(activity);
  const roles = createdRolesFrom(activity);

  // Fill in the names of the roles these rows point at. A deleted role keeps
  // its row, so the admin still sees that the work happened.
  const roleIds = [...new Set([...selections.map((item) => item.roleId), ...roles.map((role) => role.id)])];
  const rolesRepository = getRolesRepository();
  const lookedUp = await Promise.all(
    roleIds.map((id) => rolesRepository.getRole(id).catch(() => null)),
  );
  const titles = new Map<string, string>();
  lookedUp.forEach((role, index) => {
    if (role) titles.set(roleIds[index], role.title);
  });
  for (const item of selections) item.roleTitle = titles.get(item.roleId) ?? null;
  for (const role of roles) role.title = titles.get(role.id) ?? null;

  return (
    <>
      <Link
        href="/dashboard/settings/team"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Team
      </Link>

      <SettingsPageHeader title={member.name} tip="What this person has done on the workspace." />

      <section className="rounded-2xl border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="text-muted">
            Email <span className="ml-1.5 font-medium text-foreground">{member.email ?? "the admin login"}</span>
          </span>
          <span className="text-muted">
            Added <span className="ml-1.5 font-medium text-foreground">{formatDay(member.createdAt)}</span>
          </span>
          {addedBy && (
            <span className="text-muted">
              Added by <span className="ml-1.5 font-medium text-foreground">{addedBy}</span>
            </span>
          )}
        </div>
      </section>

      <MemberWorkTabs
        memberName={member.name}
        interviews={interviews}
        selections={selections}
        roles={roles}
      />

      <h2 className="mb-3 mt-8 font-semibold tracking-tight">Everything {member.name} did</h2>
      <ActivityLog people={[{ id: member.id, name: member.name }]} fixedPersonId={member.id} />
    </>
  );
}
