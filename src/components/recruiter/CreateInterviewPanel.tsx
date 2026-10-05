"use client";

import { useState } from "react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import { CreateInterviewForm } from "./CreateInterviewForm";
import { InterviewLinkResult } from "./InterviewLinkResult";

interface CreateResult {
  room: InterviewRoom;
  candidateUrl: string;
}

export function CreateInterviewPanel() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  async function handleSubmit(values: {
    title: string;
    candidateName?: string;
    durationMinutes?: number;
  }) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          candidateName: values.candidateName,
          durationMinutes: values.durationMinutes,
        }),
      });
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