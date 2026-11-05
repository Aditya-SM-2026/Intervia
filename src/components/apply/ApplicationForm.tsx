"use client";

import { useId, useRef, useState } from "react";
import type { ApplicationField } from "@/lib/roles/application.types";

const inputClasses =
  "h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20";

const labelClasses = "mb-1.5 block text-sm font-medium";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turns a picked file into a readable row, or explains why it was refused. */
function resumeProblem(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "The resume must be smaller than 10 MB.";
  const name = file.name.toLowerCase();
  if (![".pdf", ".doc", ".docx"].some((extension) => name.endsWith(extension))) {
    return "Attach your resume as a PDF, DOC or DOCX file.";
  }
  return null;
}

/**
 * The public application form. Identity fields are fixed; the rest come from
 * the recruiter's per-role questions. No account is needed: the link's token
 * stands for the role.
 */
export function ApplicationForm({
  token,
  roleTitle,
  roleDescription,
  fields,
}: {
  token: string;
  roleTitle: string;
  roleDescription: string;
  fields: ApplicationField[];
}) {
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [collegeId, setCollegeId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const descriptionIsLong = roleDescription.length > 320 || roleDescription.split("\n").length > 5;

  function setAnswer(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!name.trim()) return setError("Enter your full name.");
    if (!phone.trim()) return setError("Enter your phone number.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return setError("Enter a valid email address.");
    }
    if (!resume) return setError("Attach your resume.");

    const missing = fields.find(
      (field) => field.required && !(answers[field.id] ?? "").trim(),
    );
    if (missing) return setError(`${missing.label} is required.`);
    if (!consent) return setError("Tick the consent box to send your application.");

    const body = new FormData();
    body.set("name", name.trim());
    body.set("phone", phone.trim());
    body.set("email", email.trim());
    if (collegeId.trim()) body.set("collegeId", collegeId.trim());
    body.set("answers", JSON.stringify(answers));
    body.set("resume", resume);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/apply/${encodeURIComponent(token)}`, {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Could not send your application. Please try again.");
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-surface p-6 text-center sm:p-8">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-2xl text-emerald-600 dark:text-emerald-400"
        >
          ✓
        </span>
        <h1 className="mt-4 text-xl font-semibold">Application sent</h1>
        <p className="mt-2 text-sm text-muted">
          Thanks, {name.trim().split(/\s+/)[0] || "there"}. Your details and resume are with the
          hiring team for <strong className="text-foreground">{roleTitle}</strong>. They will
          contact you at {email.trim()} if there is a next step.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-4 rounded-2xl border border-border bg-surface p-5 sm:p-7"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Apply for {roleTitle}</h1>
      {roleDescription.trim() !== "" && (
        <div className="mt-2">
          <p
            className={`whitespace-pre-line text-sm text-muted ${
              descriptionIsLong && !descriptionOpen ? "line-clamp-4" : ""
            }`}
          >
            {roleDescription}
          </p>
          {descriptionIsLong && (
            <button
              type="button"
              onClick={() => setDescriptionOpen((current) => !current)}
              aria-expanded={descriptionOpen}
              className="mt-1 text-sm font-medium text-accent hover:underline"
            >
              {descriptionOpen ? "Show less" : "Read the full description"}
            </button>
          )}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <div>
          <label className={labelClasses} htmlFor={`${formId}-name`}>
            Full name
          </label>
          <input
            id={`${formId}-name`}
            className={inputClasses}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClasses} htmlFor={`${formId}-phone`}>
              Phone number
            </label>
            <input
              id={`${formId}-phone`}
              className={inputClasses}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              required
            />
          </div>
          <div>
            <label className={labelClasses} htmlFor={`${formId}-email`}>
              Email address
            </label>
            <input
              id={`${formId}-email`}
              type="email"
              className={inputClasses}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
        </div>

        <div>
          <label className={labelClasses} htmlFor={`${formId}-college`}>
            College roll number
          </label>
          <input
            id={`${formId}-college`}
            className={inputClasses}
            value={collegeId}
            onChange={(event) => setCollegeId(event.target.value)}
            placeholder="e.g. 21A91A0501"
          />
        </div>

        {fields.map((field) => {
          const id = `${formId}-${field.id}`;
          return (
            <div key={field.id}>
              <label className={labelClasses} htmlFor={id}>
                {field.label}
                {field.required && <span className="text-red-600 dark:text-red-400"> *</span>}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  id={id}
                  className="min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={answers[field.id] ?? ""}
                  onChange={(event) => setAnswer(field.id, event.target.value)}
                  required={field.required}
                />
              ) : field.type === "select" ? (
                <select
                  id={id}
                  className={inputClasses}
                  value={answers[field.id] ?? ""}
                  onChange={(event) => setAnswer(field.id, event.target.value)}
                  required={field.required}
                >
                  <option value="">Choose…</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "yesno" ? (
                <select
                  id={id}
                  className={inputClasses}
                  value={answers[field.id] ?? ""}
                  onChange={(event) => setAnswer(field.id, event.target.value)}
                  required={field.required}
                >
                  <option value="">Choose…</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              ) : (
                <input
                  id={id}
                  type={field.type === "number" ? "number" : "text"}
                  className={inputClasses}
                  value={answers[field.id] ?? ""}
                  onChange={(event) => setAnswer(field.id, event.target.value)}
                  required={field.required}
                />
              )}
              {field.hint && <p className="mt-1 text-xs text-muted">{field.hint}</p>}
            </div>
          );
        })}

        <div>
          <span className={labelClasses}>Resume</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            id={`${formId}-resume`}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              const problem = file ? resumeProblem(file) : null;
              if (problem) {
                setResume(null);
                if (fileRef.current) fileRef.current.value = "";
                setError(problem);
                return;
              }
              setError(null);
              setResume(file);
            }}
          />
          {resume ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/10 text-[11px] font-bold text-accent"
              >
                FILE
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{resume.name}</span>
                <span className="block text-xs text-muted">{formatBytes(resume.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setResume(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="text-xs font-medium text-muted hover:text-foreground hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <label
              htmlFor={`${formId}-resume`}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm transition hover:border-accent hover:bg-accent/5"
            >
              <span className="font-medium text-accent">Choose a file</span>
              <span className="text-muted">PDF, DOC or DOCX up to 10 MB</span>
            </label>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            I agree to my details and resume being stored for this role and used to assess my
            application.
          </span>
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-5 h-11 w-full rounded-lg bg-accent text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {submitting ? "Sending…" : "Send application"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        One application per email address for this role.
      </p>
    </form>
  );
}
