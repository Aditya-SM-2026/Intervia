"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import { CreateInterviewForm, type CreateInterviewFormValues } from "./CreateInterviewForm";
import { InterviewLinkResult } from "./InterviewLinkResult";

interface InviteEmailStatus {
  status: "sent" | "failed" | "not_configured";
  detail?: string;
}

interface CreateResult {
  room: InterviewRoom;
  candidateUrl: string;
  uploadUrl?: string | null;
  duplicate?: boolean;
  inviteEmail?: InviteEmailStatus;
}

export function CreateInterviewPanel() {
  return (
    <Suspense fallback={null}>
      <CreateInterviewPanelInner />
    </Suspense>
  );
}

function CreateInterviewPanelInner() {
  const router = useRouter();
  const roleParam = useSearchParams().get("role") ?? undefined;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  async function handleSubmit(values: CreateInterviewFormValues) {
    setIsSubmitting(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("recruiterName", values.recruiterName);
      form.set("candidateName", values.candidateName);
      form.set("candidateEmail", values.candidateEmail);
      form.set("roleTitle", values.roleTitle);
      if (values.scheduledDate) {
        form.set("scheduledDate", values.scheduledDate);
        form.set("scheduledTime", values.scheduledTime ?? "");
      }
      form.set("durationMinutes", String(values.durationMinutes));
      form.set("difficulty", values.difficulty);
      form.set("voiceMode", values.voiceMode);
      if (values.jobDescriptionPdf) {
        form.set("jobDescriptionPdf", values.jobDescriptionPdf);
      } else if (values.jobDescriptionText) {
        form.set("jobDescriptionText", values.jobDescriptionText);
      }
      if (values.resume) {
        form.set("resume", values.resume);
      }

      const response = await fetch("/api/interviews", { method: "POST", body: form });
      if (response.status === 401) {
        router.replace("/login?next=/recruiter");
        return;
      }
      const data = await response.json();

      if (response.status === 409 && data?.room && data?.candidateUrl) {
        // A double submit or a retry hit the same schedule: show the
        // existing interview instead of an error.
        setResult({ room: data.room, candidateUrl: data.candidateUrl, duplicate: true });
        return;
      }

      if (!response.ok) {
        throw new Error(
          data?.error?.message ?? "Could not create the interview. Please try again.",
        );
      }

      setResult({ ...(data as CreateResult), duplicate: undefined });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the interview. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
        {result.duplicate && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            This interview was already scheduled — showing the existing link instead of creating a
            second one.
          </p>
        )}
        <InterviewLinkResult result={result} onReset={() => setResult(null)} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <CreateInterviewForm onSubmit={handleSubmit} isSubmitting={isSubmitting} initialRoleTitle={roleParam} />
    </div>
  );
}