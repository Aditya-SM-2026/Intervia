"use client";

import { useState } from "react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import { CreateInterviewForm, type CreateInterviewFormValues } from "./CreateInterviewForm";
import { InterviewLinkResult } from "./InterviewLinkResult";

interface CreateResult {
  room: InterviewRoom;
  candidateUrl: string;
}

/** Per-file upload cap; anything larger must be compressed before use. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Combined cap: the platform rejects requests over ~32 MB outright. */
const MAX_UPLOAD_TOTAL_BYTES = 28 * 1024 * 1024;

export function CreateInterviewPanel() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  async function handleSubmit(values: CreateInterviewFormValues) {
    setIsSubmitting(true);
    setError(null);

    const totalBytes = values.resume.size + (values.jobDescriptionPdf?.size ?? 0);
    if (values.resume.size > MAX_UPLOAD_BYTES || (values.jobDescriptionPdf?.size ?? 0) > MAX_UPLOAD_BYTES) {
      setIsSubmitting(false);
      setError("Each file must be under 20 MB. Compress the PDF, or paste the job description as text.");
      return;
    }
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      setIsSubmitting(false);
      setError("The resume and job description together must stay under 28 MB. Compress them and try again.");
      return;
    }

    try {
      const form = new FormData();
      form.set("recruiterName", values.recruiterName);
      form.set("candidateName", values.candidateName);
      form.set("candidateEmail", values.candidateEmail);
      form.set("roleTitle", values.roleTitle);
      form.set("durationMinutes", String(values.durationMinutes));
      form.set("difficulty", values.difficulty);
      if (values.jobDescriptionPdf) {
        form.set("jobDescriptionPdf", values.jobDescriptionPdf);
      } else if (values.jobDescriptionText) {
        form.set("jobDescriptionText", values.jobDescriptionText);
      }
      form.set("resume", values.resume);

      const response = await fetch("/api/interviews", { method: "POST", body: form });
      // Failure responses are not always JSON (proxies return HTML/plain
      // errors, oversized uploads are cut off) — never trust response.json().
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      const message =
        typeof (data as { error?: { message?: string } | null })?.error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : null;

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error("The upload is too large. Keep each file under 20 MB.");
        }
        throw new Error(
          message ?? `Could not create the interview (HTTP ${response.status}). Please try again.`,
        );
      }
      if (!data || typeof data !== "object") {
        throw new Error("The server returned an unexpected response. Please try again.");
      }

      setResult(data as CreateResult);
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
    return <InterviewLinkResult result={result} onReset={() => setResult(null)} />;
  }

  return (
    <div className="grid h-full gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <CreateInterviewForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}