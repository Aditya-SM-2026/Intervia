import type { Metadata } from "next";
import { ActivityLog } from "@/components/settings/ActivityLog";
import { AdminOnly, SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { OWNER_ID, isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { accountDisplayName } from "@/lib/auth/session";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/** Who did what, and when (admin only). */
export default async function ActivityPage() {
  const actor = await getActor();
  const admin = isAdmin(actor);
  const people = admin
    ? [{ id: OWNER_ID, name: accountDisplayName() }, ...(await getAccountsRepository().listMembers()).map((m) => ({ id: m.id, name: m.name }))]
    : [];
  return (
    <>
        <SettingsPageHeader
          title="Activity"
          tip="Every change anyone made: sign-ins, roles, forms, invitations, interviews, decisions, settings and downloads, with the person, time and address."
        />
        {admin ? <ActivityLog people={people} /> : <AdminOnly />}
    </>
  );
}
