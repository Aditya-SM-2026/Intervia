"use client";

import { useId, useRef, useState } from "react";
import type { DifficultyLevel, VoiceMode } from "@/lib/interviews/interview.types";
import {
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/lib/interviews/interview.validation";

export interface CreateInterviewFormValues {
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  roleTitle: string;
  durationMinutes: number;
  difficulty: DifficultyLevel;
  voiceMode: VoiceMode;
  scheduledDate?: string;
  scheduledTime?: string;
  jobDescriptionText?: string;
  jobDescriptionPdf?: File;
  resume?: File;
}

interface CreateInterviewFormProps {
  onSubmit: (values: CreateInterviewFormValues) => void;
  isSubmitting: boolean;
  /** Role title pre-filled from the roles page (share link / add candidate). */
  initialRoleTitle?: string;
}

const inputClasses =
  "h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20";

const labelClasses = "mb-1.5 block text-sm font-medium";

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; hint: string }[] = [
  { value: "easy", label: "Easy", hint: "Relaxed and encouraging. Simple questions." },
  { value: "medium", label: "Medium", hint: "Practical questions with one follow-up each." },
  { value: "hard", label: "Hard", hint: "Digs into decisions, trade-offs and results." },
  { value: "extra-hard", label: "Extra hard", hint: "Bar-raiser. Changes constraints, chases reasoning." },
];

const VOICE_OPTIONS: { value: VoiceMode; label: string; hint: string }[] = [
  {
    value: "standard",
    label: "Standard (current version)",
    hint: "One continuous voice session for the whole interview. This is the version you have tested. About $1.80 an hour in a 3-minute test, and the rate rises as the interview gets longer.",
  },
  {
    value: "rolling",
    label: "Lower cost (fresh session every 90 seconds)",
    hint: "Same interviewer and voice. The session is renewed at each topic and about every 90 seconds, carrying the conversation as text, so earlier audio is not paid for again. About $1.10 an hour in a 3-minute test, and the rate stays flat.",
  },
];

/** Minutes offered as one-tap choices, kept to those inside the allowed range. */
const DURATION_PRESETS = [2, 5, 10, 15, 20, 30, 45].filter(
  (minutes) => minutes >= MIN_DURATION_MINUTES && minutes <= MAX_DURATION_MINUTES,
);

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A PDF picker that shows what was chosen, and accepts a dropped file. */
function PdfPicker({
  file,
  onChange,
  prompt,
  compact = false,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  prompt: string;
  compact?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(candidate: File | undefined | null) {
    if (!candidate) return;
    if (candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf")) {
      onChange(candidate);
    }
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/10 text-[11px] font-bold text-accent"
        >
          PDF
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{file.name}</span>
          <span className="block text-xs text-muted">{formatBytes(file.size)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:bg-surface hover:text-foreground"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files?.[0]);
      }}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 ${
        compact ? "px-3 py-2.5" : "px-4 py-6"
      } ${dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent hover:bg-accent/5"}`}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => take(event.target.files?.[0])}
        className="sr-only"
      />
      <span className="font-medium text-accent">Choose a PDF</span>
      <span className="text-muted">{prompt}</span>
    </label>
  );
}

export function CreateInterviewForm({ onSubmit, isSubmitting, initialRoleTitle }: CreateInterviewFormProps) {
  const [recruiterName, setRecruiterName] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [roleTitle, setRoleTitle] = useState(initialRoleTitle ?? "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("standard");
  const [jobDescriptionText, setJobDescriptionText] = useState("");
  const [jobDescriptionPdf, setJobDescriptionPdf] = useState<File | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const voice = VOICE_OPTIONS.find((option) => option.value === voiceMode) ?? VOICE_OPTIONS[0];
  const style = DIFFICULTY_OPTIONS.find((option) => option.value === difficulty);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (!jobDescriptionText.trim() && !jobDescriptionPdf) {
      setLocalError("Add the job description: paste the text or choose a PDF.");
      return;
    }
    onSubmit({
      recruiterName: recruiterName.trim(),
      candidateName: candidateName.trim(),
      candidateEmail: candidateEmail.trim(),
      roleTitle: roleTitle.trim(),
      durationMinutes,
      difficulty,
      voiceMode,
      ...(scheduledDate ? { scheduledDate, scheduledTime } : {}),
      ...(jobDescriptionPdf ? { jobDescriptionPdf } : { jobDescriptionText: jobDescriptionText.trim() }),
      ...(resume ? { resume } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="grid content-start gap-6">
          <fieldset className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <legend className="sr-only">Candidate and role</legend>
            <h2 className="text-lg font-semibold">Candidate and role</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="candidate-name" className={labelClasses}>
                  Candidate name
                </label>
                <input
                  id="candidate-name"
                  type="text"
                  required
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Aditya Rao"
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
                  autoComplete="off"
                  placeholder="aditya@example.com"
                  value={candidateEmail}
                  onChange={(event) => setCandidateEmail(event.target.value)}
                  aria-describedby="candidate-email-hint"
                  className={inputClasses}
                />
                <p id="candidate-email-hint" className="mt-1.5 text-xs text-muted">
                  The link opens only for this address.
                </p>
              </div>
              <div>
                <label htmlFor="role-title" className={labelClasses}>
                  Role
                </label>
                <input
                  id="role-title"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="Backend Engineer"
                  value={roleTitle}
                  onChange={(event) => setRoleTitle(event.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="recruiter-name" className={labelClasses}>
                  Your name
                </label>
                <input
                  id="recruiter-name"
                  type="text"
                  required
                  maxLength={200}
                  autoComplete="name"
                  placeholder="Priya Sharma"
                  value={recruiterName}
                  onChange={(event) => setRecruiterName(event.target.value)}
                  aria-describedby="recruiter-name-hint"
                  className={inputClasses}
                />
                <p id="recruiter-name-hint" className="mt-1.5 text-xs text-muted">
                  The candidate is told who will follow up.
                </p>
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium" id="schedule-label">
                  Scheduled date and time
                </span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="scheduled-date" className="sr-only">
                      Interview date
                    </label>
                    <input
                      id="scheduled-date"
                      type="date"
                      aria-labelledby="schedule-label"
                      value={scheduledDate}
                      onChange={(event) => setScheduledDate(event.target.value)}
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label htmlFor="scheduled-time" className="sr-only">
                      Interview time
                    </label>
                    <input
                      id="scheduled-time"
                      type="time"
                      aria-labelledby="schedule-label"
                      value={scheduledTime}
                      onChange={(event) => setScheduledTime(event.target.value)}
                      className={inputClasses}
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  An invitation email is sent to the candidate. Leave empty to let them start any
                  time before the link expires.
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <legend className="sr-only">How the interview runs</legend>
            <h2 className="text-lg font-semibold">How the interview runs</h2>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="duration" className="text-sm font-medium">
                  Length
                </label>
                <output htmlFor="duration" className="text-sm font-semibold tabular-nums">
                  {durationMinutes} minutes
                </output>
              </div>
              <input
                id="duration"
                type="range"
                min={MIN_DURATION_MINUTES}
                max={MAX_DURATION_MINUTES}
                step={1}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                className="mt-2 w-full accent-accent"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setDurationMinutes(minutes)}
                    aria-pressed={durationMinutes === minutes}
                    className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition ${
                      durationMinutes === minutes
                        ? "border-accent bg-accent text-white"
                        : "border-border text-muted hover:border-accent hover:text-foreground"
                    }`}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={labelClasses}>Interviewer style</span>
              <div
                className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1 sm:grid-cols-4"
                role="radiogroup"
                aria-label="Interviewer style"
              >
                {DIFFICULTY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-lg px-2 py-2 text-center text-sm font-medium transition focus-within:ring-2 focus-within:ring-accent/30 ${
                      difficulty === option.value
                        ? "bg-accent text-white"
                        : "text-muted hover:bg-surface hover:text-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="difficulty"
                      value={option.value}
                      checked={difficulty === option.value}
                      onChange={() => setDifficulty(option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{style?.hint}</p>
            </div>

            <div>
              <label htmlFor="voice-mode" className={labelClasses}>
                Voice engine
              </label>
              <select
                id="voice-mode"
                value={voiceMode}
                onChange={(event) => setVoiceMode(event.target.value as VoiceMode)}
                aria-describedby="voice-mode-hint"
                className={`${inputClasses} cursor-pointer pr-8`}
              >
                {VOICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p id="voice-mode-hint" className="mt-1.5 text-xs text-muted">
                {voice.hint} The cost of each interview is shown on its dashboard page.
              </p>
            </div>
          </fieldset>
        </div>

        <fieldset className="grid content-start gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <legend className="sr-only">What the interviewer should know</legend>
          <div>
            <h2 className="text-lg font-semibold">What the interviewer should know</h2>
            <p className="mt-1 text-sm text-muted">
              The questions come from the job description. The resume makes the follow-ups
              specific to this candidate, and answers are later checked against it.
            </p>
          </div>

          <div>
            <label htmlFor="jd-text" className={labelClasses}>
              Job description
            </label>
            {jobDescriptionPdf ? (
              <PdfPicker file={jobDescriptionPdf} onChange={setJobDescriptionPdf} prompt="" />
            ) : (
              <>
                <textarea
                  id="jd-text"
                  maxLength={20000}
                  rows={9}
                  placeholder="Paste the job description here"
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescriptionText(event.target.value)}
                  className={`${inputClasses} h-auto resize-y py-2.5 leading-relaxed`}
                />
                {!jobDescriptionText.trim() && (
                  <div className="mt-2">
                    <PdfPicker
                      file={null}
                      onChange={(file) => {
                        setJobDescriptionPdf(file);
                        if (file) setJobDescriptionText("");
                      }}
                      prompt="instead of pasting"
                      compact
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <span className={labelClasses}>Candidate resume (optional)</span>
            <PdfPicker file={resume} onChange={setResume} prompt="or drop it here" />
            <p className="mt-1.5 text-xs text-muted">
              No resume yet? A one-time upload link is generated for the candidate.
            </p>
          </div>
        </fieldset>
      </div>

      {localError && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {localError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 sm:px-6">
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">{durationMinutes} minutes</span>,{" "}
          {style?.label.toLowerCase()} style,{" "}
          {voiceMode === "rolling" ? "lower-cost voice" : "standard voice"}. Link valid for 3 days.
        </p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Building the interview plan…" : "Create interview"}
        </button>
      </div>
    </form>
  );
}
