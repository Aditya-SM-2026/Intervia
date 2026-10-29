import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { EditInterviewPanel } from "@/components/recruiter/EditInterviewPanel";
import { getInterviewEditState } from "@/lib/interviews/interview.service";

export const metadata: Metadata = {
  title: "Edit interview",
};

/**
 * Edit a scheduled interview that the candidate has not opened yet. The
 * service decides whether editing is still open, so the rule lives in one
 * place for both the page and the API.
 */
export default async function EditInterviewPage({
  params,
}: PageProps<"/dashboard/[roomId]/edit">) {
  const { roomId } = await params;
  const state = await getInterviewEditState(roomId);
  if (!state) notFound();

  const { room } = state;

  return (
    <ThemeProvider>
      <TopNav />
      <main className="min-h-[calc(100vh-64px)] w-full bg-[#f8fafc] px-4 py-6 sm:px-6 lg:px-8 dark:bg-background">
        <div className="mx-auto w-full max-w-4xl">
          <Link
            href="/dashboard"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to interviews
          </Link>

          <div className="mb-5">
            <h1 className="text-2xl font-semibold">Edit interview</h1>
            <p className="mt-1 text-sm text-muted">
              {room.candidateName ?? "This candidate"} · {room.roleTitle ?? room.title}
            </p>
          </div>

          {state.editable ? (
            <EditInterviewPanel
              roomId={room.id}
              initial={{
                recruiterName: room.recruiterName ?? "",
                candidateName: room.candidateName ?? "",
                candidateEmail: room.candidateEmail ?? "",
                roleTitle: room.roleTitle ?? room.title,
                durationMinutes: room.durationMinutes,
                difficulty: room.difficulty,
                voiceMode: room.voiceMode,
                jobDescriptionText: room.jobDescription?.text ?? "",
                existingResumeName: room.resume?.fileName ?? null,
              }}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
              <h2 className="text-lg font-semibold">This interview can no longer be edited</h2>
              <p className="mt-2 text-sm text-muted">{state.reason}</p>
              <Link
                href="/dashboard"
                className="mt-5 inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Back to dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </ThemeProvider>
  );
}
