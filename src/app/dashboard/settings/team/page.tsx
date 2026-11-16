import type { Metadata } from "next";
import { AdminOnly, SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { TeamManager } from "@/components/settings/TeamManager";
import { isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { accountDisplayName } from "@/lib/auth/session";
import { publicMember } from "@/lib/team/public-member";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/** Who can sign in (admin only). */
export default async function TeamPage() {
  const actor = await getActor();
  const admin = isAdmin(actor);
  const members = admin ? (await getAccountsRepository().listMembers()).map(publicMember) : [];
  return (
    <>
        <SettingsPageHeader
          title="Team"
          tip="Give each person who hires with you their own login. They can do everything except manage the team, and everything they do is recorded under their name in Activity."
        />
        {admin ? <TeamManager initial={members} ownerName={accountDisplayName()} /> : <AdminOnly />}
    </>
  );
}
