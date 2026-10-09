"use client";

import { useRef, useState } from "react";
import type { DifficultyLevel } from "@/lib/interviews/interview.types";
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from "@/lib/interviews/interview.validation";

export interface CreateInterviewFormValues {
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  durationMinutes: number;
  difficulty: DifficultyLevel;
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

const DIFFICULTY_OPTIONS: {
  value: DifficultyLevel;
  label: string;
  hint: string;
}[] = [
  { value: "easy", label: "Easy", hint: "Relaxed and encouraging; simple questions." },
  { value: "medium", label: "Medium", hint: "Practical questions with follow-up probes." },
  { value: "hard", label: "Hard", hint: "Deep-dives into experience and problems solved." },
  { value: "extra-hard", label: "Extra Hard", hint: "Top-MNC bar-raiser style: pressure, pivots, drill-downs." },
];

export function CreateInterviewForm({ onSubmit, isSubmitting }: CreateInterviewFormProps) {
  const [recruiterName, setRecruiterName] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(MIN_DURATION_MINUTES);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
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

    onSubmit({
      recruiterName: recruiterName.trim(),
      candidateName: candidateName.trim(),
      candidateEmail: candidateEmail.trim(),
      roleTitle: roleTitle.trim(),
      durationMinutes,
      difficulty,
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
          Interview duration: <strong>{durationMinutes} minutes</strong>
        </label>
        <input
          id="duration"
          type="range"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          step={1}
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-xs text-muted">
          <span>{MIN_DURATION_MINUTES} min</span>
          <span>{MAX_DURATION_MINUTES} min</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          The AI interviewer wraps the interview up at this length. The link
          itself stays valid for 24 hours.
        </p>
      </div>

      <div>
        <span className={labelClasses}>Interviewer difficulty</span>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interviewer difficulty">
          {DIFFICULTY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                difficulty === option.value
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                name="difficulty"
                value={option.value}
                checked={difficulty === option.value}
                onChange={() => setDifficulty(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          This is the personality of the AI interviewer — how hard it pushes
          and how it asks.
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