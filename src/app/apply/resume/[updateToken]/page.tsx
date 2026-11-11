import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/BrandMark";
import { ReplaceResumeForm } from "@/components/apply/ReplaceResumeForm";
import { getResumeUpdateState } from "@/lib/roles/application.service";

export const metadata: Metadata = { title: "Replace your resume" };

/**
 * The candidate's private page for fixing a resume they uploaded by mistake.
 * The token in the address is the credential; the page never exposes anything
 * beyond the role, their own name and the file on record.
 */
export default async function ReplaceResumePage({
  params,
}: {
  params: Promise<{ updateToken: string }>;
}) {
  const { updateToken } = await params;
  const state = await getResumeUpdateState(updateToken).catch(() => null);

  return (
    <main className="relative min-h-dvh px-4 pb-16 pt-8 sm:pt-12">
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px]" />
      <div className="mx-auto w-full max-w-2xl">
        <BrandMark href={null} />
        {state === null ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center sm:p-10">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">This link is not valid</h1>
            <p className="mt-2 text-sm text-muted">
              Ask the recruiting team to send you a new resume link.
            </p>
          </div>
        ) : !state.open ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center sm:p-10">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">This link is closed</h1>
            <p className="mt-2 text-sm text-muted">{state.closedMessage}</p>
          </div>
        ) : (
          <>
            <div className="mt-6">
              <p className="text-sm text-muted">Application</p>
              <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                {state.roleTitle}
              </h1>
              <p className="mt-2 text-sm text-muted">
                Hello {state.candidateName.split(/\s+/)[0] || "there"}. If the resume you sent was
                the wrong file, choose the correct one below and save it.
              </p>
            </div>
            <ReplaceResumeForm
              updateToken={updateToken}
              currentFileName={state.fileName}
              lastUpdatedAt={state.updatedAt}
            />
            <p className="mt-4 text-center text-xs text-muted">
              This private link stops working on{" "}
              {new Date(state.expiresAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
