"use client";

import { Check, ChevronDown, FileText, Upload } from "lucide-react";
import { DocumentText } from "@/components/ui/DocumentText";

import { useId, useRef, useState } from "react";
import type { ApplicationField } from "@/lib/roles/application.types";

const inputClasses =
  "h-11 w-full rounded-xl border border-border bg-background/50 px-3.5 text-[15px] text-foreground outline-none transition placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 sm:text-sm";

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
  const [education, setEducation] = useState("");
  const [cgpa, setCgpa] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [update, setUpdate] = useState<{
    previousFileName: string | null;
    fileName: string | null;
  } | null>(null);


  const byId = (id: string) => fields.find((field) => field.id === id && field.system);
  const nameField = byId("name");
  const phoneField = byId("phone");
  const emailField = byId("email");
  const collegeField = byId("collegeId");
  const educationField = byId("education");
  const cgpaField = byId("cgpa");
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
    if (educationField?.required && !education.trim()) {
      setError(`${educationField.label} is required.`);
      return;
    }
    if (cgpaField?.required && !cgpa.trim()) {
      setError(`${cgpaField.label} is required.`);
      return;
    }
    if (cgpaField && cgpa.trim() && !/^\d+(\.\d+)?$/.test(cgpa.trim())) {
      setError("Enter the CGPA as a number, for example 8.4 or 78.");
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
    if (educationField && education.trim()) body.set("education", education.trim());
    if (cgpaField && cgpa.trim()) body.set("cgpa", cgpa.trim());
    body.set("answers", JSON.stringify(answers));
    body.set("resume", resume);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/apply/${encodeURIComponent(token)}`, {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => null)) as
        | {
            resumeToken?: string | null;
            updated?: boolean;
            previousFileName?: string | null;
            fileName?: string | null;
            error?: { message?: string };
          }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Could not send your application. Please try again.");
      }
      if (typeof data?.resumeToken === "string" && data.resumeToken !== "") {
        setResumeToken(data.resumeToken);
      }
      if (data?.updated) {
        setUpdate({
          previousFileName: data.previousFileName ?? null,
          fileName: data.fileName ?? null,
        });
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
      <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center shadow-sm shadow-black/[0.03] sm:p-10">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <Check className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">
          {update ? "Application updated" : "Application sent"}
        </h1>
        {update ? (
          <p className="mt-2 text-sm text-muted">
            Thanks, {name.trim().split(/\s+/)[0] || "there"}. We found your earlier application
            for <strong className="text-foreground">{roleTitle}</strong> with this email and phone,
            and replaced the resume on it. Nothing else you filled in has changed.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Thanks, {name.trim().split(/\s+/)[0] || "there"}. Your details and resume are with the
            hiring team for <strong className="text-foreground">{roleTitle}</strong>. They will
            contact you at {email.trim()} if there is a next step.
          </p>
        )}
        {update && (
          <div className="mt-5 rounded-xl border border-border bg-background/50 p-4 text-left text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">Resume on your application</p>
            <p className="mt-1 font-medium">{update.fileName ?? "your new file"}</p>
            {update.previousFileName && update.previousFileName !== update.fileName && (
              <p className="mt-1 text-xs text-muted">
                It replaced {update.previousFileName}, which the hiring team will no longer see.
              </p>
            )}
          </div>
        )}
        {resumeToken && (
          <div className="mt-6 rounded-xl border border-border bg-background/50 p-4 text-left">
            <p className="text-sm font-medium">Uploaded the wrong file?</p>
            <p className="mt-1 text-xs text-muted">
              This private link lets you replace your resume. Keep it to yourself: anyone who has
              it can change the file on your application.
            </p>
            <a
              href={`/apply/resume/${encodeURIComponent(resumeToken)}`}
              className="mt-3 inline-flex h-10 items-center rounded-lg border border-border px-3.5 text-sm font-medium transition hover:border-foreground/25 hover:bg-foreground/[0.03]"
            >
              Replace my resume
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={preview ? "" : "mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/[0.03] sm:p-8"}
    >
      {preview && (
        <p className="mb-5 rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
          Preview. This is what applicants see; nothing typed here is sent.
        </p>
      )}
      <p className="text-sm text-muted">Application</p>
      <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{roleTitle}</h1>
      {roleDescription.trim() !== "" && (
        <details className="group mt-4 rounded-xl border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
            About the role
            <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="max-h-[28rem] overflow-y-auto border-t border-border px-4 py-4">
            <DocumentText text={roleDescription} />
          </div>
        </details>
      )}

      <div className="mt-7 space-y-5">
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
              case "education":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-education`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    <select
                      id={`${formId}-education`}
                      className={inputClasses}
                      value={education}
                      onChange={(event) => setEducation(event.target.value)}
                      required={field.required}
                    >
                      <option value="">Choose…</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </FieldShell>
                );
              case "cgpa":
                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={`${formId}-cgpa`}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                  >
                    <input
                      id={`${formId}-cgpa`}
                      type="text"
                      inputMode="decimal"
                      className={inputClasses}
                      value={cgpa}
                      onChange={(event) => setCgpa(event.target.value)}
                      placeholder="e.g. 8.4"
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
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
                        <span
                          aria-hidden
                          className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
                        >
                          <FileText className="size-4" />
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
                        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm transition hover:border-foreground/30 hover:bg-foreground/[0.02]"
                      >
                        <Upload className="size-5 text-muted" aria-hidden />
                        <span className="font-medium text-accent">Choose your resume</span>
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
                  className="min-h-28 w-full rounded-xl border border-border bg-background/50 px-3.5 py-3 text-[15px] leading-6 outline-none transition placeholder:text-muted/70 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 sm:text-sm"
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
                <div id={id} role="radiogroup" aria-label={field.label} className="grid grid-cols-2 gap-2">
                  {["Yes", "No"].map((option) => {
                    const active = answers[field.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setAnswer(field.id, option)}
                        className={`h-11 rounded-xl border text-sm font-medium transition ${
                          active ? "border-accent bg-accent-soft text-accent" : "border-border hover:border-foreground/25"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
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
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
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
          className="mt-5 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || preview}
        className="mt-6 h-12 w-full rounded-xl bg-accent text-[15px] font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {preview ? "Preview only" : submitting ? "Sending…" : "Send application"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        One application per email address for this role. Applied before? Sending again with the
        same email and phone replaces the resume on your existing application.
      </p>
    </form>
  );
}
