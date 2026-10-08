"use client";

import { useRef, useState } from "react";

export interface CreateInterviewFormValues {
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  durationMinutes?: number;
  jobDescriptionText?: string;
  jobDescriptionPdf?: File;
  resume: File;
}

interface CreateInterviewFormProps {
  onSubmit: (values: CreateInterviewFormValues) => void;
  isSubmitting: boolean;
}

const inputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-accent";

const labelClasses = "mb-1 block text-sm font-medium";

export function CreateInterviewForm({ onSubmit, isSubmitting }: CreateInterviewFormProps) {
  const [recruiterName, setRecruiterName] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [jobDescriptionText, setJobDescriptionText] = useState("");
  const [jobDescriptionPdf, setJobDescriptionPdf] = useState<File | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (!resume) {
      setLocalError("Upload the candidate's resume (PDF).");
      return;
    }
    if (!jobDescriptionText.trim() && !jobDescriptionPdf) {
      setLocalError("Add the job description as pasted text or a PDF.");
      return;
    }

    const duration = durationMinutes.trim();
    onSubmit({
      recruiterName: recruiterName.trim(),
      candidateName: candidateName.trim(),
      candidateEmail: candidateEmail.trim(),
      roleTitle: roleTitle.trim(),
      durationMinutes: duration ? Number(duration) : undefined,
      ...(jobDescriptionPdf ? { jobDescriptionPdf } : { jobDescriptionText: jobDescriptionText.trim() }),
      resume,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="recruiter-name" className={labelClasses}>
            Your name (recruiter)
          </label>
          <input
            id="recruiter-name"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Priya Sharma"
            value={recruiterName}
            onChange={(event) => setRecruiterName(event.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="candidate-name" className={labelClasses}>
            Candidate name
          </label>
          <input
            id="candidate-name"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Aditya"
            value={candidateName}
            onChange={(event) => setCandidateName(event.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="candidate-email" className={labelClasses}>
            Candidate email
          </label>
          <input
            id="candidate-email"
            type="email"
            required
            maxLength={200}
            placeholder="e.g. aditya@example.com"
            value={candidateEmail}
            onChange={(event) => setCandidateEmail(event.target.value)}
            className={inputClasses}
          />
          <p className="mt-1 text-xs text-muted">
            Only this email can open the interview link.
          </p>
        </div>
        <div>
          <label htmlFor="role-title" className={labelClasses}>
            Role title
          </label>
          <input
            id="role-title"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Backend Engineer"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
            className={inputClasses}
          />
        </div>
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

      <div>
        <label htmlFor="jd-text" className={labelClasses}>
          Job description
        </label>
        <textarea
          id="jd-text"
          rows={6}
          maxLength={20000}
          placeholder="Paste the job description, or upload a PDF below…"
          value={jobDescriptionText}
          onChange={(event) => {
            setJobDescriptionText(event.target.value);
            if (event.target.value.trim()) {
              setJobDescriptionPdf(null);
              if (jdFileRef.current) jdFileRef.current.value = "";
            }
          }}
          className={inputClasses}
        />
        <input
          ref={jdFileRef}
          id="jd-pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setJobDescriptionPdf(file);
            if (file) setJobDescriptionText("");
          }}
          className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p className="mt-1 text-xs text-muted">Paste text or upload a PDF — not both.</p>
      </div>

      <div>
        <label htmlFor="resume-pdf" className={labelClasses}>
          Candidate resume <span className="font-normal text-muted">(PDF)</span>
        </label>
        <input
          ref={resumeRef}
          id="resume-pdf"
          type="file"
          required
          accept="application/pdf,.pdf"
          onChange={(event) => setResume(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p className="mt-1 text-xs text-muted">
          The AI interviewer uses this to ask about the candidate&apos;s own experience.
        </p>
      </div>

      {localError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {localError}
        </p>
      )}

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