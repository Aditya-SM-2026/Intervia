"use client";

import { useState } from "react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import { CreateInterviewForm, type CreateInterviewFormValues } from "./CreateInterviewForm";
import { InterviewLinkResult } from "./InterviewLinkResult";

interface CreateResult {
  room: InterviewRoom;
  candidateUrl: string;
}

export function CreateInterviewPanel() {
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
      if (values.durationMinutes !== undefined) {
        form.set("durationMinutes", String(values.durationMinutes));
      }
      if (values.jobDescriptionPdf) {
        form.set("jobDescriptionPdf", values.jobDescriptionPdf);
      } else if (values.jobDescriptionText) {
        form.set("jobDescriptionText", values.jobDescriptionText);
      }
      form.set("resume", values.resume);

      const response = await fetch("/api/interviews", { method: "POST", body: form });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error?.message ?? "Could not create the interview. Please try again.",
        );
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
    <div className="grid gap-3">
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