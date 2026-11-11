import { BrandMark } from "@/components/brand/BrandMark";
import type { Metadata } from "next";
import { ApplicationForm } from "@/components/apply/ApplicationForm";
import { getPublicApplicationState } from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const state = await getPublicApplicationState(token).catch(() => ({
    form: null,
    closedReason: null,
  }));
  return {
    title: state.form?.roleTitle ? `Apply for ${state.form.roleTitle} | Intervia` : "Apply | Intervia",
    description: state.form?.roleDescription
      ? state.form.roleDescription.slice(0, 160)
      : "Submit your application on Intervia.",
  };
}

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
    <main className="relative min-h-dvh overflow-hidden px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
      <div
        aria-hidden
        className="bg-grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 -z-10 size-[34rem] rounded-full bg-accent/[0.07] blur-3xl"
      />
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <BrandMark href={null} />
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-muted uppercase sm:inline-flex">
              <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" />
              Candidate application
            </span>
          </div>
        </div>
        {state.form ? (
          <div className="mt-8">
            <ApplicationForm
              token={token}
              roleTitle={state.form.roleTitle}
              roleDescription={state.form.roleDescription}
              fields={state.form.fields}
            />
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-md rounded-[28px] border border-border bg-surface p-8 text-center shadow-[0_20px_60px_-35px_rgba(8,26,61,0.3)] sm:p-10">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Applications are closed</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              {closedReasonMessage(state.closedReason)}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
