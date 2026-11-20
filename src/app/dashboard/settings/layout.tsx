import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { SettingsNav, type SettingsNavGroup } from "@/components/settings/SettingsNav";
import { isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";

/** Every settings page: the top bar, then a settings sidebar beside the page. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const admin = isAdmin(await getActor());
  const groups: SettingsNavGroup[] = [
    {
      label: "Interviewer",
      // Behaviour and Voice change how every interview runs, so they belong to
      // the admin login. Team members work from the overview.
      items: admin
        ? [
            { href: "/dashboard/settings", label: "Overview", icon: "overview" },
            { href: "/dashboard/settings/agent", label: "Behaviour", icon: "agent" },
            { href: "/dashboard/settings/voice", label: "Voice", icon: "voice" },
          ]
        : [{ href: "/dashboard/settings", label: "Overview", icon: "overview" }],
    },
    admin
      ? {
          label: "Workspace",
          items: [
            { href: "/dashboard/settings/team", label: "Team", icon: "team" },
            { href: "/dashboard/settings/activity", label: "Activity", icon: "activity" },
          ],
        }
      : { label: "You", items: [{ href: "/dashboard/settings/account", label: "Your password", icon: "account" }] },
  ];

  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <SettingsNav groups={groups} />
          <div className="min-w-0 max-w-4xl">{children}</div>
        </div>
      </main>
    </ThemeProvider>
  );
}
