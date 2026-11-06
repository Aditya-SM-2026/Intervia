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

/** One labelled question wrapper shared by every field type. */
function FieldShell({
  htmlFor,
  label,
  required,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {htmlFor ? (
        <label className={labelClasses} htmlFor={htmlFor}>
          {label}
          {required && <span className="text-red-600 dark:text-red-400"> *</span>}
        </label>
      ) : (
        <span className={labelClasses}>
          {label}
          {required && <span className="text-red-600 dark:text-red-400"> *</span>}
        </span>
      )}
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The public application form. Questions, labels and order come from the
 * role's saved form, including the built-in fields. No account is needed: the
 * link's token stands for the role. In preview mode the form renders exactly
 * as the candidate sees it but cannot be submitted.
 */
export function ApplicationForm({
  token,
  roleTitle,
  roleDescription,
  fields,
  preview = false,
}: {
  token: string;
  roleTitle: string;
  roleDescription: string;
  fields: ApplicationField[];
  preview?: boolean;
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

  const byId = (id: string) => fields.find((field) => field.id === id && field.system);
  const nameField = byId("name");
  const phoneField = byId("phone");
  const emailField = byId("email");
  const collegeField = byId("collegeId");
  const customFields = fields.filter((field) => !field.system);

  function setAnswer(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  async function submitApplication() {
    if (submitting) return;
    setError(null);

    if (!name.trim()) {
      setError(`${nameField?.label ?? "Full name"} is required.`);
      return;
    }
    if (!phone.trim()) {
      setError(`${phoneField?.label ?? "Phone number"} is required.`);
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(`Enter a valid ${(emailField?.label ?? "email address").toLowerCase()}.`);
      return;
    }
    if (collegeField?.required && !collegeId.trim()) {
      setError(`${collegeField.label} is required.`);
      return;
    }
    if (!resume) {
      setError("Attach your resume.");
      return;
    }

    const missing = customFields.find(
      (field) => field.required && !(answers[field.id] ?? "").trim(),
    );
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    if (!consent) {
      setError("Tick the consent box to send your application.");
      return;
    }

    const body = new FormData();
    body.set("name", name.trim());
    body.set("phone", phone.trim());
    body.set("email", email.trim());
    if (collegeField && collegeId.trim()) body.set("collegeId", collegeId.trim());
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) return;
    void submitApplication();
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
      className={`mt-4 rounded-2xl border border-border bg-surface p-5 sm:p-7 ${
        preview ? "ring-1 ring-accent/20" : ""
      }`}
    >
      {preview && (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs font-medium text-accent">
          Preview only. This is the form candidates see; nothing you type here is sent.
        </p>
      )}
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
        {fields.map((field) => {
          if (field.system) {
            switch (field.id) {
              case "name":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-name`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    <input
                      id={`${formId}-name`}
                      className={inputClasses}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      required
                    />
                  </FieldShell>
                );
              case "phone":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-phone`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
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
                  </FieldShell>
                );
              case "email":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-email`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    <input
                      id={`${formId}-email`}
                      type="email"
                      className={inputClasses}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </FieldShell>
                );
              case "collegeId":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-college`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    <input
                      id={`${formId}-college`}
                      className={inputClasses}
                      value={collegeId}
                      onChange={(event) => setCollegeId(event.target.value)}
                      placeholder="e.g. 21A91A0501"
                      required={field.required}
                    />
                  </FieldShell>
                );
              case "resume":
                return (
                  <FieldShell
                    key={field.id}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
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
                  </FieldShell>
                );
              default:
                return null;
            }
          }

          const id = `${formId}-${field.id}`;
          return (
            <FieldShell
              key={field.id}
              htmlFor={id}
              label={field.label}
              required={field.required}
              hint={field.hint}
            >
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
            </FieldShell>
          );
        })}

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
        disabled={submitting || preview}
        className="mt-5 h-11 w-full rounded-lg bg-accent text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {preview ? "Preview only" : submitting ? "Sending…" : "Send application"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        One application per email address for this role.
      </p>
    </form>
  );
}
