import { BrandMark } from "@/components/brand/BrandMark";
import type { Metadata } from "next";
import { ApplicationForm } from "@/components/apply/ApplicationForm";
import { getPublicApplicationState } from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";

export const metadata: Metadata = { title: "Apply" };

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
    <main className="relative min-h-dvh px-4 pb-16 pt-8 sm:pt-12">
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px]" />
      <div className="mx-auto w-full max-w-2xl">
        <BrandMark href={null} />
        {state.form ? (
          <ApplicationForm
            token={token}
            roleTitle={state.form.roleTitle}
            roleDescription={state.form.roleDescription}
            fields={state.form.fields}
          />
        ) : (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center sm:p-10">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Applications are closed</h1>
            <p className="mt-2 text-sm text-muted">{closedReasonMessage(state.closedReason)}</p>
          </div>
        )}
      </div>
    </main>
  );
}
