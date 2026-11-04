"use client";

import { useId, useRef, useState } from "react";
import type { DifficultyLevel } from "@/lib/interviews/interview.types";
import { normalizeSkillFocus, type SkillFocus } from "@/lib/interviews/skill-focus";
import type { InterviewRoleDefaults } from "@/lib/roles/interview-role-defaults";
import { CustomScoringDialog } from "./CustomScoringDialog";
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
  /** Existing role the interview belongs to; omitted for a brand-new role. */
  roleId?: string;
  durationMinutes: number;
  difficulty: DifficultyLevel;
  jobDescriptionText?: string;
  jobDescriptionPdf?: File;
  resume?: File;
  /** Optional per-skill question weights (custom scoring). */
  skillFocus?: SkillFocus[];
}

interface CreateInterviewFormProps {
  onSubmit: (values: CreateInterviewFormValues) => void;
  isSubmitting: boolean;
  /** Role title pre-filled from an older ?role= link. */
  initialRoleTitle?: string;
  /**
   * Role the interview is being created for, from the roles page. Its title is
   * fixed to the role and the job description starts from the role's own.
   */
  initialRole?: InterviewRoleDefaults | null;
  /** Roles HR already has, offered as choices instead of retyping them. */
  roles?: InterviewRoleDefaults[];
  /**
   * Values to start from when editing an existing interview. The resume file
   * is never sent to the browser; its name is shown so the recruiter knows
   * one is on file and only uploading replaces it.
   */
  initial?: Partial<CreateInterviewFormValues> & { existingResumeName?: string | null };
  submitLabel?: string;
  submittingLabel?: string;
  footerNote?: string;
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

export function CreateInterviewForm({
  onSubmit,
  isSubmitting,
  initialRoleTitle,
  initialRole = null,
  roles = [],
  initial,
  submitLabel = "Create interview",
  submittingLabel = "Building the interview plan…",
  footerNote,
}: CreateInterviewFormProps) {
  const [recruiterName, setRecruiterName] = useState(initial?.recruiterName ?? "");
  const [candidateName, setCandidateName] = useState(initial?.candidateName ?? "");
  const [candidateEmail, setCandidateEmail] = useState(initial?.candidateEmail ?? "");
  const [roleTitle, setRoleTitle] = useState(
    initial?.roleTitle ?? initialRole?.title ?? initialRoleTitle ?? "",
  );
  /** "new" means the visitor is typing a new role; otherwise this is a role id. */
  const [roleChoice, setRoleChoice] = useState(
    initial?.roleId ?? initialRole?.id ?? (roles.length > 0 ? "new" : ""),
  );
  const [durationMinutes, setDurationMinutes] = useState(
    initial?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(initial?.difficulty ?? "medium");
  const [jobDescriptionText, setJobDescriptionText] = useState(
    initial?.jobDescriptionText ?? initialRole?.jobDescription ?? "",
  );
  const [jobDescriptionPdf, setJobDescriptionPdf] = useState<File | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [skillFocus, setSkillFocus] = useState<SkillFocus[]>(
    () => initial?.skillFocus ?? initialRole?.skills.map((skill) => ({ skill, weight: 50 })) ?? [],
  );
  const [scoringOpen, setScoringOpen] = useState(false);

  const style = DIFFICULTY_OPTIONS.find((option) => option.value === difficulty);
  const selectedRole = roles.find((role) => role.id === roleChoice) ?? null;
  const roleSkills = selectedRole?.skills ?? initialRole?.skills ?? [];
  // The title is only typed when there is no existing role to pick (or when
  // the recruiter chose to create a new one).
  const showRoleTitleInput = roles.length === 0 || selectedRole === null;

  /** Compact summary shown on the custom-scoring row. */
  const customScoringSummary =
    skillFocus.length === 0
      ? "Optional: weight the skills so the interviewer spends more time on what matters."
      : skillFocus
          .slice(0, 4)
          .map((item) => `${item.skill} ${item.weight}`)
          .join(" · ") + (skillFocus.length > 4 ? ` · +${skillFocus.length - 4} more` : "");

  const customScoringControl = (
    <div>
      <span className={labelClasses}>Custom scoring (optional)</span>
      <button
        type="button"
        onClick={() => setScoringOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {skillFocus.length === 0
              ? "Set how much each skill matters"
              : `${skillFocus.length} parameter${skillFocus.length === 1 ? "" : "s"} set`}
          </span>
          <span className="block truncate text-xs text-muted">{customScoringSummary}</span>
        </span>
        <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold text-accent">
          {skillFocus.length === 0 ? "Set up" : "Edit"}
        </span>
      </button>
    </div>
  );

  /**
   * Picking an existing role replaces the title and job description with that
   * role's, so the common case needs no retyping. Choosing "new" clears them
   * for a fresh entry.
   */
  function handleRoleChange(next: string) {
    setRoleChoice(next);
    // A different role has different skills, so an old weighting no longer
    // applies. The next open of the box starts from the new role's skills.
    setSkillFocus([]);
    if (next === "new") {
      setRoleTitle("");
      setJobDescriptionText("");
      return;
    }
    const role = roles.find((candidate) => candidate.id === next);
    if (role) {
      setRoleTitle(role.title);
      setJobDescriptionText(role.jobDescription);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError(null);

    // The role's own title wins when an existing role is selected.
    const title = selectedRole ? selectedRole.title : roleTitle.trim();
    if (!title) {
      setLocalError("Choose a role or enter the role title.");
      return;
    }
    if (!jobDescriptionText.trim() && !jobDescriptionPdf) {
      setLocalError("Add the job description: paste the text or choose a PDF.");
      return;
    }

    onSubmit({
      recruiterName: recruiterName.trim(),
      candidateName: candidateName.trim(),
      candidateEmail: candidateEmail.trim(),
      roleTitle: title,
      roleId: selectedRole?.id,
      durationMinutes,
      difficulty,
      ...(jobDescriptionPdf
        ? { jobDescriptionPdf }
        : { jobDescriptionText: jobDescriptionText.trim() }),
      ...(resume ? { resume } : {}),
      ...(skillFocus.length > 0 ? { skillFocus: normalizeSkillFocus(skillFocus) } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="grid content-start gap-6">
          <fieldset className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <legend className="sr-only">Candidate and role</legend>
            <h2 className="text-lg font-semibold">Candidate and role</h2>
            {roles.length > 0 && (
              <div>
                <label htmlFor="role-choice" className={labelClasses}>
                  Role
                </label>
                <select
                  id="role-choice"
                  value={roleChoice}
                  onChange={(event) => handleRoleChange(event.target.value)}
                  className={inputClasses}
                >
                  <option value="new">New role (type the title below)</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
                </select>
                {selectedRole && (
                  <p className="mt-1.5 text-xs text-muted">
                    Title, job description and skills come from this role.{" "}
                    <a
                      href={`/dashboard/roles/${selectedRole.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      View role
                    </a>
                  </p>
                )}
              </div>
            )}
            {roles.length > 0 && customScoringControl}
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
              {showRoleTitleInput && (
                <div>
                  <label htmlFor="role-title" className={labelClasses}>
                    {roles.length > 0 ? "New role title" : "Role"}
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
              )}
              {roles.length === 0 && (
                <div className="sm:col-span-2">{customScoringControl}</div>
              )}
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
                <p className="text-xs text-muted">
                  The interview link is valid for 24 hours from the moment it is created. The
                  candidate can start any time in that window; after 24 hours the link expires.
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
            {selectedRole && (
              <p className="mt-1.5 text-xs text-muted">
                Pre-filled from the role. Edit it here if this candidate needs a different
                brief, or upload a PDF to replace it.
              </p>
            )}
          </div>

          <div>
            <span className={labelClasses}>Candidate resume (optional)</span>
            <PdfPicker file={resume} onChange={setResume} prompt="or drop it here" />
            <p className="mt-1.5 text-xs text-muted">
              {initial?.existingResumeName && !resume
                ? `On file: ${initial.existingResumeName}. Upload a PDF to replace it.`
                : "No resume yet? A one-time upload link is generated for the candidate."}
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
          {footerNote ?? (
            <>
              <span className="font-medium text-foreground">{durationMinutes} minutes</span>,{" "}
              {style?.label.toLowerCase()} style. Link valid for 24 hours.
            </>
          )}
        </p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </div>

      {scoringOpen && (
        <CustomScoringDialog
          roleTitle={selectedRole?.title ?? roleTitle}
          roleSkills={roleSkills}
          focus={skillFocus}
          onSave={(focus) => {
            setSkillFocus(focus);
            setScoringOpen(false);
          }}
          onClose={() => setScoringOpen(false)}
        />
      )}
    </form>
  );
}
