"use client";

import { useState } from "react";

export interface CreateInterviewFormValues {
  title: string;
  candidateName: string;
  durationMinutes: string;
}

interface CreateInterviewFormProps {
  onSubmit: (values: {
    title: string;
    candidateName?: string;
    durationMinutes?: number;
  }) => void;
  isSubmitting: boolean;
}

const inputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-accent";

const labelClasses = "mb-1 block text-sm font-medium";

export function CreateInterviewForm({ onSubmit, isSubmitting }: CreateInterviewFormProps) {
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const duration = durationMinutes.trim();
    onSubmit({
      title: title.trim(),
      candidateName: candidateName.trim() || undefined,
      durationMinutes: duration ? Number(duration) : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div>
        <label htmlFor="title" className={labelClasses}>
          Interview title
        </label>
        <input
          id="title"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Backend Engineer Interview"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClasses}
        />
      </div>

      <div>
        <label htmlFor="candidate-name" className={labelClasses}>
          Candidate name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="candidate-name"
          type="text"
          maxLength={200}
          placeholder="e.g. Aditya"
          value={candidateName}
          onChange={(event) => setCandidateName(event.target.value)}
          className={inputClasses}
        />
      </div>

      <div>
        <label htmlFor="duration" className={labelClasses}>
          Interview duration in minutes <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="duration"
          type="number"
          min={5}
          max={240}
          step={5}
          placeholder="e.g. 30"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
          className={inputClasses}
        />
        <p className="mt-1 text-xs text-muted">
          If set, the link stops working after this many minutes (5–240).
        </p>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Creating…" : "Create interview link"}
      </button>
    </form>
  );
}