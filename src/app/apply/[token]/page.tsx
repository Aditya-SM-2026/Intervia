import type { Metadata } from "next";
import { ApplicationForm } from "@/components/apply/ApplicationForm";
import { getPublicApplicationState } from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";

export const metadata: Metadata = { title: "Apply — Sreemedhas Agent" };

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const state = await getPublicApplicationState(token).catch(() => ({
    form: null,
    closedReason: null,
  }));

  return (
    <main className="min-h-dvh bg-background px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Sreemedhas Agent
        </p>
        {state.form ? (
          <ApplicationForm
            token={token}
            roleTitle={state.form.roleTitle}
            roleDescription={state.form.roleDescription}
            fields={state.form.fields}
          />
        ) : (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-6 text-center sm:p-8">
            <h1 className="text-xl font-semibold">Applications are closed</h1>
            <p className="mt-2 text-sm text-muted">{closedReasonMessage(state.closedReason)}</p>
          </div>
        )}
      </div>
    </main>
  );
}
