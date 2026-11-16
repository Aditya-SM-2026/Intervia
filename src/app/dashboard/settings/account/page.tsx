import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { getActor } from "@/lib/auth/actor";

export const metadata: Metadata = { title: "Your password" };
export const dynamic = "force-dynamic";

/** A team member's own password. */
export default async function AccountPage() {
  const actor = await getActor();
  return (
    <>
        <SettingsPageHeader title="Your password" tip="Change the password you sign in with. Your other devices are signed out when you do." />
        {actor?.role === "member" ? (
          <ChangePasswordForm />
        ) : (
          <p className="rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
            The admin password is set on the server, not here.
          </p>
        )}
    </>
  );
}
