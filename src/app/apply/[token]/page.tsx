import type { Metadata } from "next";
import { ApplicationForm } from "@/components/apply/ApplicationForm";
import { getPublicApplicationForm } from "@/lib/roles/application.service";

export const metadata: Metadata = { title: "Apply — Sreemedhas Agent" };

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const form = await getPublicApplicationForm(token).catch(() => null);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Sreemedhas Agent
        </p>
        {form ? (
          <ApplicationForm
            token={token}
            roleTitle={form.roleTitle}
            roleDescription={form.roleDescription}
            fields={form.fields}
          />
        ) : (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-6 text-center sm:p-8">
            <h1 className="text-xl font-semibold">Applications are closed</h1>
            <p className="mt-2 text-sm text-muted">
              This link is no longer accepting applications. Ask the recruiter who shared it
              for a new one.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
