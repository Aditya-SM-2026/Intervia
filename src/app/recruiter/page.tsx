import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";
import { getRoleForForm, listRoleOptions } from "@/lib/roles/role.service";
import { roleToInterviewDefaults } from "@/lib/roles/interview-role-defaults";

export const metadata: Metadata = {
  title: "New interview",
};

/**
 * Same chrome as the reports dashboard (TopNav), so the recruiter moves
 * between Interviews / Roles / New interview without the navbar changing
 * underneath them.
 *
 * Opened from a role's "Add candidate" action, the role and its job
 * description are loaded here (server-side, behind the same sign-in gate as
 * the rest of /recruiter) and handed to the form already filled in.
 */
export default async function RecruiterPage({ searchParams }: PageProps<"/recruiter">) {
  const params = await searchParams;
  const roleId = typeof params.roleId === "string" ? params.roleId : null;
  // Older copied links carry ?role=<title>; they still get the title prefill.
  const legacyRoleTitle = !roleId && typeof params.role === "string" ? params.role : undefined;

  const role = roleId ? await getRoleForForm(roleId).catch((error: unknown) => {
    // A role lookup must never block the form; the recruiter can still fill
    // everything in by hand.
    console.error(`[recruiter] role prefill failed: ${String(error)}`);
    return null;
  }) : null;

  // Every role HR already has, so the form can offer them instead of asking
  // for the title and description again.
  const roleOptions = await listRoleOptions()
    .then((roles) => roles.map(roleToInterviewDefaults))
    .catch((error: unknown) => {
      console.error(`[recruiter] role list failed: ${String(error)}`);
      return [];
    });
  const initialRole = role ? roleToInterviewDefaults(role) : null;

  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold">New interview</h1>
        <p className="mt-1 mb-6 max-w-2xl text-muted">
          The job description and resume become the interview plan. You will see the plan
          before you send the link.
        </p>
        <CreateInterviewPanel
          initialRole={initialRole}
          initialRoleTitle={initialRole ? undefined : legacyRoleTitle}
          roles={roleOptions}
        />
      </main>
    </ThemeProvider>
  );
}
