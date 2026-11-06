"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import type { DifficultyLevel } from "@/lib/interviews/interview.types";
import type { SkillFocus } from "@/lib/interviews/skill-focus";
import { CreateInterviewForm, type CreateInterviewFormValues } from "./CreateInterviewForm";

interface InviteEmailStatus {
  status: "sent" | "failed" | "not_configured";
  detail?: string;
}

interface EditResult {
  candidateUrl: string;
  changes: string[];
  inviteEmail: InviteEmailStatus | null;
}

export interface EditInterviewInitialValues {
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  durationMinutes: number;
  difficulty: DifficultyLevel;
  jobDescriptionText: string;
  existingResumeName: string | null;
  /** The custom scoring set when the interview was created, if any. */
  skillFocus?: SkillFocus[];
  /** Stored date and time, in the recruiter's scheduling timezone. */
  scheduledDate: string;
  scheduledTime: string;
}

interface EditInterviewPanelProps {
  roomId: string;
  initial: EditInterviewInitialValues;
  /** The link's window has run out; saving reopens it. */
  expired?: boolean;
  /** IANA zone the date and time fields are read in. */
  timezone: string;
}

const EMAIL_STATUS_TEXT: Record<InviteEmailStatus["status"], string> = {
  sent: "The updated invitation was emailed to the candidate.",
  not_configured: "Email is not configured on this server, so nothing was sent. Share the link below.",
  failed: "The email could not be sent. Share the link below.",
};

/**
 * The edit screen for a scheduled interview. It reuses the create form, sends
 * the same fields to the edit endpoint, and then shows what changed, the
 * refreshed link, and whether the update email went out.
 */
export function EditInterviewPanel({
  roomId,
  initial,
  expired = false,
  timezone,
}: EditInterviewPanelProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<EditResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(initial.scheduledDate);
  const [scheduledTime, setScheduledTime] = useState(initial.scheduledTime);

  async function handleSubmit(values: CreateInterviewFormValues) {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.set("recruiterName", values.recruiterName);
      form.set("candidateName", values.candidateName);
      form.set("candidateEmail", values.candidateEmail);
      form.set("roleTitle", values.roleTitle);
      form.set("scheduledDate", scheduledDate);
      form.set("scheduledTime", scheduledTime);
      form.set("durationMinutes", String(values.durationMinutes));
      form.set("difficulty", values.difficulty);
      if (values.jobDescriptionPdf) {
        form.set("jobDescriptionPdf", values.jobDescriptionPdf);
      } else if (values.jobDescriptionText) {
        form.set("jobDescriptionText", values.jobDescriptionText);
      }
      if (values.resume) form.set("resume", values.resume);
      // Always send the list, including an empty one: clearing custom scoring
      // on the edit screen is a real change, not an omission.
      form.set("skillFocus", JSON.stringify(values.skillFocus ?? []));

      const response = await fetch(`/api/interviews/${roomId}/edit`, {
        method: "PATCH",
        body: form,
      });
      if (response.status === 401) {
        router.replace(`/login?next=/dashboard/${roomId}/edit`);
        return;
      }
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Could not save the changes. Please try again.");
      }

      if (!data?.changes?.length) {
        setNotice("Nothing changed, so no email was sent. Edit a field and save again.");
        return;
      }

      setResult({
        candidateUrl: data.candidateUrl,
        changes: data.changes,
        inviteEmail: data.inviteEmail ?? null,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the changes. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link. Select it and copy it manually.");
    }
  }

  if (result) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
          <h2 className="text-lg font-semibold">Changes saved</h2>
          <p className="mt-1 text-sm text-muted">
            The link below is the interview link with your changes. Any earlier link with the
            candidate now points to the same updated interview.
          </p>

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">What changed</p>
            <ul className="grid gap-1.5 text-sm text-muted">
              {result.changes.map((change) => (
                <li key={change} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">Candidate link</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-foreground/[0.04] px-3 py-2 text-xs">
                {result.candidateUrl}
              </code>
              <button
                type="button"
                onClick={() => copyLink(result.candidateUrl)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-foreground/[0.05]"
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <p
            className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
              result.inviteEmail?.status === "sent"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            {EMAIL_STATUS_TEXT[result.inviteEmail?.status ?? "not_configured"]}
            {result.inviteEmail?.detail ? ` (${result.inviteEmail.detail})` : ""}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-foreground/[0.05]"
            >
              Keep editing
            </button>
          </div>
        </div>
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
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          {notice}
        </p>
      )}
      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Interview date and time</h2>
            <p className="mt-1 text-xs text-muted">
              Times are in {timezone}. The link stays valid for 24 hours after this time.
            </p>
          </div>
          {expired && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              Link expired
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium text-muted">
            Date
            <input
              type="date"
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted">
            Time
            <input
              type="time"
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
            />
          </label>
        </div>

        <p className="mt-2 text-xs text-muted">
          {expired
            ? "Leave both empty and save to reopen the link right now for 24 hours, or set a date and time to reopen it then."
            : "Leave both empty and save to let the candidate join any time in the next 24 hours."}
        </p>
      </div>

      <CreateInterviewForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        initial={{
          recruiterName: initial.recruiterName,
          candidateName: initial.candidateName,
          candidateEmail: initial.candidateEmail,
          roleTitle: initial.roleTitle,
          durationMinutes: initial.durationMinutes,
          difficulty: initial.difficulty,
          jobDescriptionText: initial.jobDescriptionText,
          existingResumeName: initial.existingResumeName,
          skillFocus: initial.skillFocus ?? [],
        }}
        submitLabel="Save changes"
        submittingLabel="Saving and rebuilding the interview plan…"
        footerNote="Saving emails the candidate the new link with these changes listed."
      />
    </div>
  );
}
