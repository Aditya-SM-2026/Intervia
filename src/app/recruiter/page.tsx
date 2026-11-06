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
  // "Schedule interview" on a form application fills in who it is for.
  const candidateName = typeof params.candidateName === "string" ? params.candidateName : "";
  const candidateEmail = typeof params.candidateEmail === "string" ? params.candidateEmail : "";

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
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-16 -z-10 h-[420px]" />
      <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <header className="pb-7 pt-9">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">New interview</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            The job description and resume become the interview plan. You see the plan before you send the link.
          </p>
        </header>
        <CreateInterviewPanel
          initialRole={initialRole}
          initialRoleTitle={initialRole ? undefined : legacyRoleTitle}
          initialCandidateName={candidateName}
          initialCandidateEmail={candidateEmail}
          roles={roleOptions}
        />
      </main>
    </ThemeProvider>
  );
}
