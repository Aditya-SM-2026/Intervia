"use client";

import { useId, useRef, useState } from "react";
import type { DifficultyLevel } from "@/lib/interviews/interview.types";
import { DEFAULT_SKILL_WEIGHT, normalizeSkillFocus, type SkillFocus } from "@/lib/interviews/skill-focus";
import type { InterviewRoleDefaults } from "@/lib/roles/interview-role-defaults";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import { DocumentText } from "@/components/ui/DocumentText";
import { SegmentedTabs } from "@/components/ui/animated";
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
  "h-10 w-full min-w-0 rounded-lg border border-border bg-background/50 px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15";

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
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-[10px] font-semibold text-rose-600 dark:text-rose-400"
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
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-sm transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15 ${
        compact ? "px-3 py-2.5" : "px-4 py-5"
      } ${dragging ? "border-accent bg-accent-soft" : "border-border hover:border-foreground/30 hover:bg-foreground/[0.02]"}`}
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

  const style = DIFFICULTY_OPTIONS.find((option) => option.value === difficulty);
  const selectedRole = roles.find((role) => role.id === roleChoice) ?? null;
  const roleSkills = selectedRole?.skills ?? initialRole?.skills ?? [];
  // The title is only typed when there is no existing role to pick (or when
  // the recruiter chose to create a new one).
  const showRoleTitleInput = roles.length === 0 || selectedRole === null;

  /** The skills shown in the focus step: the saved weights, or the role's skills at normal weight. */
  const focusRows: SkillFocus[] =
    skillFocus.length > 0 ? skillFocus : roleSkills.map((skill) => ({ skill, weight: DEFAULT_SKILL_WEIGHT }));
  const heavySkills = focusRows.filter((row) => row.weight > DEFAULT_SKILL_WEIGHT).map((row) => row.skill);

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
      // The server fills this in from the signed-in account.
      recruiterName: initial?.recruiterName ?? "",
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

  const [jdView, setJdView] = useState<"edit" | "preview">(
    jobDescriptionText.trim().length > 0 && (selectedRole !== null || initialRole !== null) ? "preview" : "edit",
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="grid min-w-0 gap-6">
        <Step number={1} title="Who is this for" description="The link opens only for this email address.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="candidate-name" label="Candidate name">
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
            </Field>
            <Field id="candidate-email" label="Candidate email">
              <input
                id="candidate-email"
                type="email"
                required
                maxLength={200}
                autoComplete="off"
                placeholder="aditya@example.com"
                value={candidateEmail}
                onChange={(event) => setCandidateEmail(event.target.value)}
                className={inputClasses}
              />
            </Field>
          </div>
        </Step>

        <Step
          number={2}
          title="Role and job description"
          description="Questions come from the job description. The resume makes follow-ups specific to this person."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {roles.length > 0 && (
              <Field id="role-choice" label="Role">
                <div className="relative">
                  <select
                    id="role-choice"
                    value={roleChoice}
                    onChange={(event) => {
                      handleRoleChange(event.target.value);
                      setJdView(event.target.value === "new" ? "edit" : "preview");
                    }}
                    className={`${inputClasses} cursor-pointer appearance-none pr-9`}
                  >
                    <option value="new">A new role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                </div>
              </Field>
            )}
            {showRoleTitleInput && (
              <Field id="role-title" label={roles.length > 0 ? "New role title" : "Role"}>
                <input
                  id="role-title"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="Backend developer"
                  value={roleTitle}
                  onChange={(event) => setRoleTitle(event.target.value)}
                  className={inputClasses}
                />
              </Field>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Job description</span>
              {!jobDescriptionPdf && jobDescriptionText.trim() && (
                <SegmentedTabs
                  id="create-jd"
                  label="Job description view"
                  value={jdView}
                  onChange={setJdView}
                  options={[
                    { value: "preview", label: "Preview" },
                    { value: "edit", label: "Edit" },
                  ]}
                />
              )}
            </div>
            {jobDescriptionPdf ? (
              <PdfPicker file={jobDescriptionPdf} onChange={setJobDescriptionPdf} prompt="" />
            ) : jdView === "preview" && jobDescriptionText.trim() ? (
              <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-background/40 px-5 py-4">
                <DocumentText text={jobDescriptionText} />
              </div>
            ) : (
              <>
                <textarea
                  id="jd-text"
                  aria-label="Job description"
                  maxLength={20000}
                  rows={10}
                  placeholder="Paste the job description here"
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescriptionText(event.target.value)}
                  className={`${inputClasses} h-auto resize-y py-3 leading-6`}
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
                From the role.{" "}
                <a href={`/dashboard/roles/${selectedRole.id}`} className="font-medium text-accent hover:underline">
                  Open role
                </a>
                . Changes here apply to this interview only.
              </p>
            )}
          </div>

          <div className="mt-5">
            <span className="mb-1.5 block text-sm font-medium">
              Resume <span className="font-normal text-muted">(optional)</span>
            </span>
            <PdfPicker file={resume} onChange={setResume} prompt="or drop it here" />
            <p className="mt-1.5 text-xs text-muted">
              {initial?.existingResumeName && !resume
                ? `On file: ${initial.existingResumeName}. Upload a PDF to replace it.`
                : "Without one, the candidate gets a link to upload it."}
            </p>
          </div>
        </Step>

        <Step
          number={3}
          title="What to focus on"
          description="Set how much each skill matters. The interviewer spends more time on heavier skills, and they count more in the score."
        >
          <FocusEditor
            rows={focusRows}
            onChange={setSkillFocus}
          />
        </Step>

        <Step number={4} title="How it runs">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="duration" className="text-sm font-medium">
                Length
              </label>
              <output htmlFor="duration" className="text-sm font-semibold tabular-nums">
                {durationMinutes} min
              </output>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setDurationMinutes(minutes)}
                  aria-pressed={durationMinutes === minutes}
                  className={`h-8 rounded-lg px-3 text-sm font-medium tabular-nums transition ${
                    durationMinutes === minutes
                      ? "bg-foreground text-background"
                      : "bg-foreground/[0.05] text-foreground/75 hover:bg-foreground/[0.09] hover:text-foreground"
                  }`}
                >
                  {minutes}
                </button>
              ))}
            </div>
            <input
              id="duration"
              type="range"
              min={MIN_DURATION_MINUTES}
              max={MAX_DURATION_MINUTES}
              step={1}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
              aria-label="Length in minutes"
              className="mt-3 w-full accent-[var(--accent)]"
            />
          </div>

          <fieldset className="mt-6">
            <legend className="mb-2 text-sm font-medium">Interviewer style</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DIFFICULTY_OPTIONS.map((option) => {
                const active = difficulty === option.value;
                return (
                  <label
                    key={option.value}
                    className={`relative cursor-pointer rounded-xl border p-3.5 transition focus-within:ring-4 focus-within:ring-accent/15 ${
                      active ? "border-accent bg-accent-soft/60" : "border-border hover:border-foreground/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="difficulty"
                      value={option.value}
                      checked={active}
                      onChange={() => setDifficulty(option.value)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{option.label}</span>
                      <span
                        aria-hidden
                        className={`grid size-4 place-items-center rounded-full border ${active ? "border-accent bg-accent" : "border-foreground/25"}`}
                      >
                        {active && <span className="size-1.5 rounded-full bg-white" />}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted">{option.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Step>
      </div>

      <aside className="rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-20">
        <h2 className="text-[15px] font-semibold">This interview</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <SummaryRow label="Candidate" value={candidateName.trim() || "—"} />
          <SummaryRow label="Role" value={(selectedRole ? selectedRole.title : roleTitle.trim()) || "—"} />
          <SummaryRow label="Length" value={`${durationMinutes} minutes`} />
          <SummaryRow label="Style" value={style?.label ?? "—"} />
          <SummaryRow
            label="Focus"
            value={heavySkills.length === 0 ? "Even across skills" : heavySkills.slice(0, 2).join(", ") + (heavySkills.length > 2 ? ` +${heavySkills.length - 2}` : "")}
          />
          <SummaryRow
            label="Job description"
            value={jobDescriptionPdf ? "PDF" : jobDescriptionText.trim() ? "Added" : "Missing"}
            warn={!jobDescriptionPdf && !jobDescriptionText.trim()}
          />
          <SummaryRow
            label="Resume"
            value={resume ? "Attached" : initial?.existingResumeName ? "On file" : "Candidate uploads"}
          />
        </dl>
        {localError && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {localError}
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
        <p className="mt-3 text-xs leading-5 text-muted">
          {footerNote ?? "You see the interview plan before sending. The link stays valid for 24 hours."}
        </p>
      </aside>

    </form>
  );
}

function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold tabular-nums text-background"
        >
          {number}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function SummaryRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`truncate text-right font-medium ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</dd>
    </div>
  );
}

/** Five weight levels, from left out to the main focus. */
const FOCUS_LEVELS: { weight: number; label: string }[] = [
  { weight: 0, label: "Skip" },
  { weight: 25, label: "Light" },
  { weight: DEFAULT_SKILL_WEIGHT, label: "Normal" },
  { weight: 75, label: "More" },
  { weight: 100, label: "Main focus" },
];

function nearestLevel(weight: number): number {
  let best = 0;
  FOCUS_LEVELS.forEach((level, index) => {
    if (Math.abs(level.weight - weight) < Math.abs(FOCUS_LEVELS[best].weight - weight)) best = index;
  });
  return best;
}

/** Each skill with a five-step weight, plus a box to add a skill. */
function FocusEditor({ rows, onChange }: { rows: SkillFocus[]; onChange: (rows: SkillFocus[]) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const skill = draft.trim();
    if (!skill || rows.some((row) => row.skill.toLowerCase() === skill.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...rows, { skill, weight: 75 }]);
    setDraft("");
  }

  return (
    <div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-foreground/[0.03] px-4 py-3 text-sm text-muted">
          No skills yet. They come from the role, or add the ones that matter below.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row, index) => {
            const level = nearestLevel(row.weight);
            return (
              <li
                key={row.skill}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3.5 py-2.5 transition ${
                  level >= 3 ? "border-accent/30 bg-accent-soft/50" : level === 0 ? "border-border opacity-60" : "border-border"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.skill}</span>
                <div role="radiogroup" aria-label={`How much ${row.skill} matters`} className="flex items-center gap-1">
                  {FOCUS_LEVELS.map((option, optionIndex) => {
                    const active = optionIndex === level;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={option.label}
                        onClick={() =>
                          onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, weight: option.weight } : item)))
                        }
                        className="group flex h-7 items-end px-0.5"
                      >
                        <span
                          className={`block w-2.5 rounded-sm transition-colors ${
                            optionIndex <= level && level > 0 ? "bg-accent" : "bg-foreground/15 group-hover:bg-foreground/30"
                          }`}
                          style={{ height: `${8 + optionIndex * 4}px` }}
                        />
                      </button>
                    );
                  })}
                  <span className={`ml-2 w-[4.5rem] text-xs font-medium ${level >= 3 ? "text-accent" : "text-muted"}`}>
                    {FOCUS_LEVELS[level].label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Remove ${row.skill}`}
                  className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          maxLength={80}
          placeholder="Add a skill, e.g. System design"
          aria-label="Add a skill"
          className={`${inputClasses} flex-1`}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]"
        >
          <Plus className="size-4 text-muted" aria-hidden />
          Add
        </button>
      </div>
    </div>
  );
}
