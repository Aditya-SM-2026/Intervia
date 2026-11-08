"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import type { InterviewRoleDefaults } from "@/lib/roles/interview-role-defaults";
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

interface CreateInterviewPanelProps {
  /**
   * Role this interview is being created for, when the form was opened from a
   * role's "Add candidate" action. Its title and job description start filled
   * in and the created interview is attached to the role by id.
   */
  initialRole?: InterviewRoleDefaults | null;
  /** Legacy prefill: only a role title, from an older ?role= link. */
  initialRoleTitle?: string;
  /** Candidate details, when opened from a form application. */
  initialCandidateName?: string;
  initialCandidateEmail?: string;
  /** Roles HR already has, offered as choices instead of retyping them. */
  roles?: InterviewRoleDefaults[];
}

export function CreateInterviewPanel({
  initialRole = null,
  initialRoleTitle,
  initialCandidateName = "",
  initialCandidateEmail = "",
  roles = [],
}: CreateInterviewPanelProps) {
  const router = useRouter();
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
      if (values.roleId) form.set("roleId", values.roleId);
      form.set("durationMinutes", String(values.durationMinutes));
      form.set("difficulty", values.difficulty);
      if (values.skillFocus && values.skillFocus.length > 0) {
        form.set("skillFocus", JSON.stringify(values.skillFocus));
      }
      if (values.projectShare !== undefined) form.set("projectShare", String(values.projectShare));
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

  const roleHref = initialRole ? `/dashboard/roles/${initialRole.id}` : null;

  if (result) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface p-6 sm:p-8">
        {result.duplicate && (
          <p className="mb-5 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            This interview already existed, so here is its link instead of a second one.
          </p>
        )}
        <InterviewLinkResult result={result} onReset={() => setResult(null)} />
        {roleHref && (
          <Link
            href={roleHref}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-foreground"
          >
            Back to {initialRole?.title}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
        >
          {error}
        </p>
      )}
      <CreateInterviewForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        initialRole={initialRole}
        initialRoleTitle={initialRoleTitle}
        initial={
          initialCandidateName || initialCandidateEmail
            ? {
                candidateName: initialCandidateName,
                candidateEmail: initialCandidateEmail,
              }
            : undefined
        }
        roles={roles}
      />
    </div>
  );
}
