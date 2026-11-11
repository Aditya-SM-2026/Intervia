"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  FileText,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { DocumentText } from "@/components/ui/DocumentText";

import { useId, useRef, useState } from "react";
import type { ApplicationField } from "@/lib/roles/application.types";

const inputClasses =
  "h-12 w-full rounded-2xl border border-border bg-background/60 px-4 text-[15px] text-foreground outline-none transition placeholder:text-muted/60 hover:border-foreground/20 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 sm:text-sm";

const labelClasses = "mb-2 flex items-center gap-1 text-[13px] font-medium text-foreground";

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
          {required && <span className="text-red-600 dark:text-red-400">*</span>}
        </label>
      ) : (
        <span className={labelClasses}>
          {label}
          {required && <span className="text-red-600 dark:text-red-400">*</span>}
        </span>
      )}
      {children}
      {hint && <p className="mt-1.5 text-xs leading-5 text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The role's story, set on a dark panel beside the form. Long descriptions
 * scroll inside the panel on desktop so the form stays the focus.
 */
function RolePanel({
  roleTitle,
  roleDescription,
  fieldCount,
  preview,
}: {
  roleTitle: string;
  roleDescription: string;
  fieldCount: number;
  preview: boolean;
}) {
  return (
    <aside
      className={`relative isolate overflow-hidden rounded-[28px] bg-[#081a3d] text-white shadow-[0_24px_80px_-40px_rgba(8,26,61,0.65)] ring-1 ring-white/10`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 100% 0%, rgba(64,112,255,0.32) 0%, rgba(8,26,61,0) 55%), radial-gradient(90% 70% at 0% 100%, rgba(64,112,255,0.18) 0%, rgba(8,26,61,0) 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "linear-gradient(to bottom, black, transparent 75%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 75%)",
        }}
      />

      <div
        className={`relative flex flex-col px-6 py-7 sm:px-8 sm:py-9 ${
          preview ? "" : "lg:px-9 lg:py-10"
        }`}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-white/60 uppercase">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
          Open role
        </div>

        <h1 className="mt-5 text-balance break-words text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-[2.45rem]">
          {roleTitle}
        </h1>

        <p className="mt-3 max-w-[36ch] text-sm leading-6 text-white/60">
          {fieldCount} {fieldCount === 1 ? "question" : "questions"}, one resume. Take your time and
          tell us what matters.
        </p>

        {roleDescription.trim() !== "" && (
          <div className="mt-8 border-t border-white/10 pt-7">
            <p className="text-[11px] font-medium tracking-[0.14em] text-white/45 uppercase">
              About the role
            </p>
            <div className="mt-4">
              <DocumentText text={roleDescription} onDark collapsedHeight={360} />
            </div>
          </div>
        )}

        <div className="mt-auto pt-8">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <ShieldCheck className="size-4 text-white/70" aria-hidden />
              Your application stays private
            </div>
            <p className="mt-1.5 text-xs leading-5 text-white/50">
              It is shared only with the hiring team for this role.
            </p>
          </div>
        </div>
      </div>
    </aside>
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
  const [dragging, setDragging] = useState(false);
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
  const customFields = fields.filter((field) => !field.system);
  const questionCount = fields.filter((field) => field.id !== "resume").length;

  function setAnswer(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  function applyResumeFile(file: File | null) {
    if (!file) return;
    const problem = resumeProblem(file);
    if (problem) {
      setResume(null);
      if (fileRef.current) fileRef.current.value = "";
      setError(problem);
      return;
    }
    setError(null);
    setResume(file);
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

  const firstName = name.trim().split(/\s+/)[0] || "there";

  return (
    <div
      className={`grid items-start gap-5 ${
        preview ? "" : "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6"
      }`}
    >
      <RolePanel
        roleTitle={roleTitle}
        roleDescription={roleDescription}
        fieldCount={questionCount}
        preview={preview}
      />

      {done ? (
        <section className="rounded-[28px] border border-border bg-surface p-6 shadow-[0_20px_60px_-35px_rgba(8,26,61,0.3)] sm:p-9 lg:p-12">
          <div className="mx-auto flex max-w-md flex-col items-center py-8 text-center sm:py-14">
            <span
              aria-hidden
              className="grid size-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <Check className="size-7" />
            </span>
            <p className="mt-6 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
              {update ? "Application updated" : "Application received"}
            </p>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.025em] sm:text-[1.7rem]">
              Thank you, {firstName}.
            </h2>
            {update ? (
              <p className="mt-3 text-sm leading-6 text-muted">
                We found your earlier application for{" "}
                <strong className="font-medium text-foreground">{roleTitle}</strong> with this email
                and phone, and replaced the resume on it. Nothing else you filled in has changed.
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">
                Your application for{" "}
                <strong className="font-medium text-foreground">{roleTitle}</strong> is with the
                hiring team. They will contact you at{" "}
                <span className="font-medium text-foreground">{email.trim()}</span> if there is a
                next step.
              </p>
            )}
            {update && (
              <div className="mt-6 w-full rounded-2xl border border-border bg-background/50 p-4 text-left">
                <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
                  Resume on your application
                </p>
                <p className="mt-1.5 text-sm font-medium">
                  {update.fileName ?? "your new file"}
                </p>
                {update.previousFileName && update.previousFileName !== update.fileName && (
                  <p className="mt-1 text-xs leading-5 text-muted">
                    It replaced {update.previousFileName}, which the hiring team will no longer see.
                  </p>
                )}
              </div>
            )}
            {resumeToken && (
              <div className="mt-3 w-full rounded-2xl border border-border bg-background/50 p-4 text-left">
                <p className="text-sm font-medium">Uploaded the wrong file?</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  This private link lets you replace your resume. Keep it to yourself: anyone who
                  has it can change the file on your application.
                </p>
                <a
                  href={`/apply/resume/${encodeURIComponent(resumeToken)}`}
                  className="mt-3 inline-flex h-10 items-center rounded-xl border border-border px-3.5 text-sm font-medium transition hover:border-foreground/25 hover:bg-foreground/[0.03]"
                >
                  Replace my resume
                </a>
              </div>
            )}
          </div>
        </section>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-[28px] border border-border bg-surface p-5 shadow-[0_20px_60px_-35px_rgba(8,26,61,0.3)] sm:p-8 lg:p-9"
        >
          <div className="mx-auto max-w-[42rem]">
            {preview && (
              <p className="mb-6 rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs font-medium text-accent">
                Preview. This is what applicants see; nothing typed here is sent.
              </p>
            )}

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium tracking-[0.14em] text-accent uppercase">
                  Candidate application
                </p>
                <h2 className="mt-1.5 text-[1.65rem] font-semibold tracking-[-0.03em] sm:text-[1.9rem]">
                  Your application
                </h2>
                <p className="mt-1.5 text-sm text-muted">
                  Fields marked <span className="text-red-600 dark:text-red-400">*</span> are
                  required.
                </p>
              </div>
              <span className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted">
                {questionCount} {questionCount === 1 ? "question" : "questions"}
              </span>
            </div>

            <div className="mt-8 space-y-6">
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
                            placeholder="Your full name"
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
                            placeholder="you@example.com"
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
                            onChange={(event) => applyResumeFile(event.target.files?.[0] ?? null)}
                          />
                          {resume ? (
                            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/50 p-3 text-sm">
                              <span
                                aria-hidden
                                className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
                              >
                                <FileText className="size-4.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{resume.name}</span>
                                <span className="block text-xs text-muted">
                                  {formatBytes(resume.size)}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setResume(null);
                                  if (fileRef.current) fileRef.current.value = "";
                                }}
                                className="rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-foreground/[0.04] hover:text-foreground"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <label
                              htmlFor={`${formId}-resume`}
                              onDragEnter={(event) => {
                                event.preventDefault();
                                setDragging(true);
                              }}
                              onDragOver={(event) => {
                                event.preventDefault();
                                setDragging(true);
                              }}
                              onDragLeave={(event) => {
                                event.preventDefault();
                                setDragging(false);
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                setDragging(false);
                                applyResumeFile(event.dataTransfer.files?.[0] ?? null);
                              }}
                              className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-5 py-7 text-center transition ${
                                dragging
                                  ? "border-accent bg-accent-soft/50"
                                  : "border-border bg-background/40 hover:border-foreground/25 hover:bg-foreground/[0.02]"
                              }`}
                            >
                              <span
                                aria-hidden
                                className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent"
                              >
                                <Upload className="size-5" />
                              </span>
                              <span className="mt-1 text-sm font-medium">
                                Drop your resume here, or <span className="text-accent">browse</span>
                              </span>
                              <span className="text-xs text-muted">PDF, DOC or DOCX up to 10 MB</span>
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
                        className="min-h-32 w-full rounded-2xl border border-border bg-background/60 px-4 py-3.5 text-[15px] leading-6 outline-none transition placeholder:text-muted/60 hover:border-foreground/20 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 sm:text-sm"
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
                      <div
                        id={id}
                        role="radiogroup"
                        aria-label={field.label}
                        className="grid grid-cols-2 gap-2.5"
                      >
                        {["Yes", "No"].map((option) => {
                          const active = answers[field.id] === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setAnswer(field.id, option)}
                              className={`h-12 rounded-2xl border text-sm font-medium transition ${
                                active
                                  ? "border-accent bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                                  : "border-border bg-background/50 hover:border-foreground/25"
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

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-foreground/[0.02] p-4 transition hover:bg-foreground/[0.035]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="text-[13px] leading-6 text-muted">
                  I agree to my details and resume being stored for this role and used to assess my
                  application.
                </span>
              </label>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || preview}
              className="group mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {preview ? "Preview only" : submitting ? "Sending…" : "Send application"}
              {!preview && !submitting && (
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              )}
            </button>
            <p className="mt-3 text-center text-xs text-muted">
              One application per email address for this role. Applied before? Sending again with the
              same email and phone replaces the resume on your existing application.
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
