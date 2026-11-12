"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  FileText,
  GraduationCap,
  Hash,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
} from "lucide-react";
import { DocumentText } from "@/components/ui/DocumentText";

import { useId, useRef, useState } from "react";
import type { ApplicationField } from "@/lib/roles/application.types";

const baseInputClasses =
  "h-12 w-full rounded-2xl border text-[15px] text-foreground outline-none transition placeholder:text-muted/60 focus:bg-surface focus:ring-4 sm:text-sm";

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

function getInputStateClasses(hasError?: boolean, isSuccess?: boolean) {
  if (hasError) {
    return "border-rose-500 bg-rose-500/[0.03] focus:border-rose-500 focus:ring-rose-500/15";
  }
  if (isSuccess) {
    return "border-emerald-500/40 bg-background/60 hover:border-foreground/20 focus:border-accent focus:ring-accent/15";
  }
  return "border-border bg-background/60 hover:border-foreground/20 focus:border-accent focus:ring-accent/15";
}

/** One labelled question wrapper shared by every field type. */
function FieldShell({
  htmlFor,
  label,
  required,
  hint,
  error,
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {htmlFor ? (
          <label className={labelClasses} htmlFor={htmlFor}>
            {label}
            {required && <span className="text-rose-500 dark:text-rose-400">*</span>}
          </label>
        ) : (
          <span className={labelClasses}>
            {label}
            {required && <span className="text-rose-500 dark:text-rose-400">*</span>}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400" role="alert">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-5 text-muted">{hint}</p>
      ) : null}
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
      className={`relative isolate overflow-hidden rounded-[28px] bg-[#081a3d] text-white shadow-[0_24px_80px_-40px_rgba(8,26,61,0.65)] ring-1 ring-white/10 ${
        preview ? "" : "lg:sticky lg:top-8 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto"
      }`}
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium tracking-[0.14em] text-white/80 uppercase backdrop-blur-sm">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]" />
            Open role
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/70 backdrop-blur-sm">
            <Clock className="size-3 text-white/60" aria-hidden />
            <span>~2 mins</span>
          </span>
        </div>

        <h1 className="mt-5 text-balance break-words text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-[2.45rem]">
          {roleTitle}
        </h1>

        <p className="mt-3 max-w-[36ch] text-sm leading-6 text-white/65">
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

        <div className="mt-8 pt-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <ShieldCheck className="size-4 text-emerald-400" aria-hidden />
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
  const [education, setEducation] = useState("");
  const [cgpa, setCgpa] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string>("");
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
  const questionCount = fields.filter((field) => field.id !== "resume").length;

  // Real-time progress calculation
  const requiredFields = fields.filter((field) => field.required);
  let completedCount = 0;
  if (name.trim()) completedCount++;
  if (phone.trim() && phone.trim().replace(/\D/g, "").length >= 7) completedCount++;
  if (email.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) completedCount++;
  if (collegeField?.required ? collegeId.trim() : false) completedCount++;
  if (educationField?.required ? education.trim() : false) completedCount++;
  if (cgpaField?.required ? cgpa.trim() : false) completedCount++;
  if (resume) completedCount++;
  for (const field of customFields) {
    if (field.required && (answers[field.id] ?? "").trim()) {
      completedCount++;
    }
  }
  const totalRequired = requiredFields.length;
  const progressPct =
    totalRequired > 0 ? Math.min(100, Math.round((completedCount / totalRequired) * 100)) : 100;

  function clearFieldError(fieldKey: string) {
    if (fieldErrors[fieldKey]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
  }

  function handleBlur(fieldKey: string) {
    setTouched((prev) => ({ ...prev, [fieldKey]: true }));
    validateSingleField(fieldKey);
  }

  function validateSingleField(fieldKey: string) {
    let message: string | null = null;
    if (fieldKey === "name") {
      if (!name.trim()) message = `${nameField?.label ?? "Full name"} is required.`;
    } else if (fieldKey === "phone") {
      if (!phone.trim()) {
        message = `${phoneField?.label ?? "Phone number"} is required.`;
      } else if (phone.trim().replace(/\D/g, "").length < 7) {
        message = "Enter a valid phone number (at least 7 digits).";
      }
    } else if (fieldKey === "email") {
      if (!email.trim()) {
        message = `${emailField?.label ?? "Email address"} is required.`;
      } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        message = "Enter a valid email address.";
      }
    } else if (fieldKey === "collegeId") {
      if (collegeField?.required && !collegeId.trim()) {
        message = `${collegeField.label} is required.`;
      }
    } else if (fieldKey === "education") {
      if (educationField?.required && !education.trim()) {
        message = `${educationField.label} is required.`;
      }
    } else if (fieldKey === "cgpa") {
      if (cgpaField?.required && !cgpa.trim()) {
        message = `${cgpaField.label} is required.`;
      } else if (cgpa.trim() && !/^\d+(\.\d+)?$/.test(cgpa.trim())) {
        message = "Enter the CGPA as a number, for example 8.4 or 78.";
      } else if (cgpa.trim() && Number(cgpa) > 100) {
        message = "Enter a CGPA or percentage between 0 and 100.";
      }
    } else if (fieldKey === "resume") {
      if (!resume) message = "Attach your resume.";
    } else {
      const custom = customFields.find((f) => f.id === fieldKey);
      if (custom?.required && !(answers[fieldKey] ?? "").trim()) {
        message = `${custom.label} is required.`;
      }
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[fieldKey] = message;
      } else {
        delete next[fieldKey];
      }
      return next;
    });
  }

  function setAnswer(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
    clearFieldError(id);
  }

  function applyResumeFile(file: File | null) {
    if (!file) return;
    const problem = resumeProblem(file);
    if (problem) {
      setResume(null);
      if (fileRef.current) fileRef.current.value = "";
      setFieldErrors((prev) => ({ ...prev, resume: problem }));
      return;
    }
    clearFieldError("resume");
    setResume(file);
  }

  async function submitApplication() {
    if (submitting) return;
    setError(null);

    // Validate all fields at once
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors["name"] = `${nameField?.label ?? "Full name"} is required.`;
    }
    if (!phone.trim()) {
      errors["phone"] = `${phoneField?.label ?? "Phone number"} is required.`;
    } else if (phone.trim().replace(/\D/g, "").length < 7) {
      errors["phone"] = "Enter a valid phone number (at least 7 digits).";
    }
    if (!email.trim()) {
      errors["email"] = `${emailField?.label ?? "Email address"} is required.`;
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      errors["email"] = "Enter a valid email address.";
    }
    if (collegeField?.required && !collegeId.trim()) {
      errors["collegeId"] = `${collegeField.label} is required.`;
    }
    if (educationField?.required && !education.trim()) {
      errors["education"] = `${educationField.label} is required.`;
    }
    if (cgpaField?.required && !cgpa.trim()) {
      errors["cgpa"] = `${cgpaField.label} is required.`;
    } else if (cgpa.trim() && !/^\d+(\.\d+)?$/.test(cgpa.trim())) {
      errors["cgpa"] = "Enter the CGPA as a number, for example 8.4 or 78.";
    } else if (cgpa.trim() && Number(cgpa) > 100) {
      errors["cgpa"] = "Enter a CGPA or percentage between 0 and 100.";
    }
    if (!resume) {
      errors["resume"] = "Attach your resume.";
    }

    for (const field of customFields) {
      if (field.required && !(answers[field.id] ?? "").trim()) {
        errors[field.id] = `${field.label} is required.`;
      }
    }

    if (!consent) {
      errors["consent"] = "Please confirm consent to submit your application.";
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      // Mark all invalid fields as touched
      setTouched((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(errors)) {
          next[key] = true;
        }
        return next;
      });
      setError("Please fix the highlighted fields above before sending.");

      // Scroll to the first invalid field
      const firstErrorKey = Object.keys(errors)[0];
      const targetId = firstErrorKey === "consent" ? `${formId}-consent` : `${formId}-${firstErrorKey}`;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus?.();
      }
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
    body.set("resume", resume!);

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
      setSubmittedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
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
          <div className="mx-auto flex max-w-md flex-col items-center py-6 text-center sm:py-10">
            <span
              aria-hidden
              className="relative grid size-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 shadow-[0_0_0_8px_rgba(52,211,153,0.08)] dark:text-emerald-400"
            >
              <Check className="size-8" />
            </span>
            <p className="mt-6 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
              {update ? "Application updated" : "Application received"}
            </p>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.025em] sm:text-[1.85rem]">
              Thank you, {firstName}.
            </h2>
            {update ? (
              <p className="mt-3 text-sm leading-6 text-muted">
                We found your earlier application for{" "}
                <strong className="font-medium text-foreground">{roleTitle}</strong> with this email
                and phone, and replaced the resume on it.
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">
                Your application for{" "}
                <strong className="font-medium text-foreground">{roleTitle}</strong> is safely with
                the hiring team. We sent confirmation to{" "}
                <span className="font-medium text-foreground">{email.trim()}</span>.
              </p>
            )}

            {/* Hiring Roadmap */}
            <div className="mt-7 w-full rounded-2xl border border-border bg-background/50 p-4 text-left">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                What happens next
              </p>
              <div className="mt-3 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" />
                  </span>
                  <div className="text-xs leading-5">
                    <p className="font-medium text-foreground">Application submitted</p>
                    <p className="text-muted">Recorded today at {submittedAt || "now"}.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="text-xs leading-5">
                    <p className="font-medium text-foreground">Automated resume & profile review</p>
                    <p className="text-muted">Screened against the core criteria for {roleTitle}.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground/[0.05] text-muted">
                    <Mail className="size-3.5" />
                  </span>
                  <div className="text-xs leading-5">
                    <p className="font-medium text-foreground">Next steps notification</p>
                    <p className="text-muted">Check your inbox for interview scheduling or updates.</p>
                  </div>
                </div>
              </div>
            </div>

            {update && (
              <div className="mt-4 w-full rounded-2xl border border-border bg-background/50 p-4 text-left">
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
              <div className="mt-4 w-full rounded-2xl border border-border bg-background/50 p-4 text-left">
                <p className="text-sm font-medium">Uploaded the wrong file?</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Use your private link if you need to replace your resume at any time before screening closes.
                </p>
                <a
                  href={`/apply/resume/${encodeURIComponent(resumeToken)}`}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold text-foreground transition hover:border-foreground/25 hover:bg-foreground/[0.03]"
                >
                  <span>Replace my resume</span>
                  <ArrowRight className="size-3.5" />
                </a>
              </div>
            )}
          </div>
        </section>
      ) : (
        <form
          id="application-form"
          onSubmit={handleSubmit}
          noValidate
          className="rounded-[28px] border border-border bg-surface p-5 shadow-[0_20px_60px_-35px_rgba(8,26,61,0.3)] sm:p-8 lg:p-9"
        >
          <div className="mx-auto max-w-[42rem]">
            {/* Mobile quick jump helper */}
            <div className="mb-4 lg:hidden">
              <a
                href="#application-form"
                className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3.5 py-2 text-xs font-medium text-accent transition hover:bg-accent-soft"
              >
                <span>Ready to apply? Fill your details below</span>
                <ArrowRight className="size-3.5" />
              </a>
            </div>

            {preview && (
              <p className="mb-6 rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs font-medium text-accent">
                Preview mode. This is how candidates experience your application form.
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
                  Fields marked <span className="text-rose-500 dark:text-rose-400">*</span> are
                  required.
                </p>
              </div>
              <span className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted">
                {questionCount} {questionCount === 1 ? "question" : "questions"}
              </span>
            </div>

            {/* Live Progress Bar */}
            <div className="mt-6 rounded-2xl border border-border bg-background/50 p-3.5">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Sparkles className="size-3.5 text-accent" />
                  Application progress
                </span>
                <span className="font-medium tabular-nums text-muted">
                  {completedCount} of {totalRequired} required filled ({progressPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            <div className="mt-8 space-y-6">
              {fields.map((field) => {
                if (field.system) {
                  switch (field.id) {
                    case "name": {
                      const hasErr = Boolean(fieldErrors["name"] && touched["name"]);
                      const isOk = Boolean(name.trim() && !fieldErrors["name"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-name`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["name"] : null}
                        >
                          <div className="relative flex items-center">
                            <User
                              className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <input
                              id={`${formId}-name`}
                              className={`${baseInputClasses} pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={name}
                              onChange={(event) => {
                                setName(event.target.value);
                                clearFieldError("name");
                              }}
                              onBlur={() => handleBlur("name")}
                              autoComplete="name"
                              placeholder="Your full name"
                              required
                            />
                            {isOk && (
                              <Check
                                className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                                aria-hidden
                              />
                            )}
                          </div>
                        </FieldShell>
                      );
                    }
                    case "phone": {
                      const hasErr = Boolean(fieldErrors["phone"] && touched["phone"]);
                      const isOk = Boolean(phone.trim() && !fieldErrors["phone"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-phone`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["phone"] : null}
                        >
                          <div className="relative flex items-center">
                            <Phone
                              className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <input
                              id={`${formId}-phone`}
                              className={`${baseInputClasses} pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={phone}
                              onChange={(event) => {
                                setPhone(event.target.value);
                                clearFieldError("phone");
                              }}
                              onBlur={() => handleBlur("phone")}
                              inputMode="tel"
                              autoComplete="tel"
                              placeholder="+91 98765 43210"
                              required
                            />
                            {isOk && (
                              <Check
                                className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                                aria-hidden
                              />
                            )}
                          </div>
                        </FieldShell>
                      );
                    }
                    case "email": {
                      const hasErr = Boolean(fieldErrors["email"] && touched["email"]);
                      const isOk = Boolean(email.trim() && !fieldErrors["email"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-email`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["email"] : null}
                        >
                          <div className="relative flex items-center">
                            <Mail
                              className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <input
                              id={`${formId}-email`}
                              type="email"
                              className={`${baseInputClasses} pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={email}
                              onChange={(event) => {
                                setEmail(event.target.value);
                                clearFieldError("email");
                              }}
                              onBlur={() => handleBlur("email")}
                              autoComplete="email"
                              placeholder="you@example.com"
                              required
                            />
                            {isOk && (
                              <Check
                                className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                                aria-hidden
                              />
                            )}
                          </div>
                        </FieldShell>
                      );
                    }
                    case "collegeId": {
                      const hasErr = Boolean(fieldErrors["collegeId"] && touched["collegeId"]);
                      const isOk = Boolean(collegeId.trim() && !fieldErrors["collegeId"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-college`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["collegeId"] : null}
                        >
                          <div className="relative flex items-center">
                            <GraduationCap
                              className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <input
                              id={`${formId}-college`}
                              className={`${baseInputClasses} pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={collegeId}
                              onChange={(event) => {
                                setCollegeId(event.target.value);
                                clearFieldError("collegeId");
                              }}
                              onBlur={() => handleBlur("collegeId")}
                              placeholder="e.g. 21A91A0501"
                              required={field.required}
                            />
                            {isOk && (
                              <Check
                                className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                                aria-hidden
                              />
                            )}
                          </div>
                        </FieldShell>
                      );
                    }
                    case "education": {
                      const hasErr = Boolean(fieldErrors["education"] && touched["education"]);
                      const isOk = Boolean(education.trim() && !fieldErrors["education"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-education`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["education"] : null}
                        >
                          <div className="relative flex items-center">
                            <GraduationCap
                              className="pointer-events-none absolute left-4 z-10 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <select
                              id={`${formId}-education`}
                              className={`${baseInputClasses} appearance-none pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={education}
                              onChange={(event) => {
                                setEducation(event.target.value);
                                clearFieldError("education");
                              }}
                              onBlur={() => handleBlur("education")}
                              required={field.required}
                            >
                              <option value="">Choose…</option>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              className="pointer-events-none absolute right-4 size-4 text-muted"
                              aria-hidden
                            />
                          </div>
                        </FieldShell>
                      );
                    }
                    case "cgpa": {
                      const hasErr = Boolean(fieldErrors["cgpa"] && touched["cgpa"]);
                      const isOk = Boolean(cgpa.trim() && !fieldErrors["cgpa"]);
                      return (
                        <FieldShell
                          key={field.id}
                          htmlFor={`${formId}-cgpa`}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["cgpa"] : null}
                        >
                          <div className="relative flex items-center">
                            <Hash
                              className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                              aria-hidden
                            />
                            <input
                              id={`${formId}-cgpa`}
                              type="text"
                              inputMode="decimal"
                              className={`${baseInputClasses} pl-11 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                              value={cgpa}
                              onChange={(event) => {
                                setCgpa(event.target.value);
                                clearFieldError("cgpa");
                              }}
                              onBlur={() => handleBlur("cgpa")}
                              placeholder="e.g. 8.4 (out of 10) or 78 (percentage)"
                              required={field.required}
                            />
                            {isOk && (
                              <Check
                                className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                                aria-hidden
                              />
                            )}
                          </div>
                        </FieldShell>
                      );
                    }
                    case "resume": {
                      const hasErr = Boolean(fieldErrors["resume"] && touched["resume"]);
                      return (
                        <FieldShell
                          key={field.id}
                          label={field.label}
                          required={field.required}
                          hint={field.hint}
                          error={hasErr ? fieldErrors["resume"] : null}
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
                            <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-background/50 p-3.5 text-sm transition hover:border-foreground/20">
                              <span
                                aria-hidden
                                className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft font-mono text-[11px] font-bold uppercase tracking-wider text-accent"
                              >
                                {resume.name.split(".").pop()?.slice(0, 4) || "DOC"}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-foreground">
                                  {resume.name}
                                </span>
                                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                                  <span>{formatBytes(resume.size)}</span>
                                  <span className="size-1 rounded-full bg-emerald-500" />
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    Ready to upload
                                  </span>
                                </span>
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => fileRef.current?.click()}
                                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-accent transition hover:bg-accent-soft"
                                >
                                  Replace
                                </button>
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
                                  ? "border-accent bg-accent-soft/60 scale-[1.01] shadow-inner"
                                  : hasErr
                                    ? "border-rose-400 bg-rose-500/[0.02]"
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
                                Drop your resume here, or <span className="text-accent underline underline-offset-2">browse</span>
                              </span>
                              <div className="mt-1 flex items-center gap-1.5">
                                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                  PDF
                                </span>
                                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                  DOC
                                </span>
                                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                  DOCX
                                </span>
                                <span className="text-xs text-muted">up to 10 MB</span>
                              </div>
                            </label>
                          )}
                        </FieldShell>
                      );
                    }
                    default:
                      return null;
                  }
                }

                const id = `${formId}-${field.id}`;
                const hasErr = Boolean(fieldErrors[field.id] && touched[field.id]);
                const isOk = Boolean((answers[field.id] ?? "").trim() && !fieldErrors[field.id]);

                return (
                  <FieldShell
                    key={field.id}
                    htmlFor={id}
                    label={field.label}
                    required={field.required}
                    hint={field.hint}
                    error={hasErr ? fieldErrors[field.id] : null}
                  >
                    {field.type === "textarea" ? (
                      <div className="space-y-1">
                        <textarea
                          id={id}
                          className={`min-h-32 w-full rounded-2xl border px-4 py-3.5 text-[15px] leading-6 outline-none transition placeholder:text-muted/60 hover:border-foreground/20 focus:bg-surface focus:ring-4 sm:text-sm ${
                            hasErr
                              ? "border-rose-500 bg-rose-500/[0.02] focus:border-rose-500 focus:ring-rose-500/15"
                              : "border-border bg-background/60 focus:border-accent focus:ring-accent/15"
                          }`}
                          value={answers[field.id] ?? ""}
                          onChange={(event) => setAnswer(field.id, event.target.value)}
                          onBlur={() => handleBlur(field.id)}
                          placeholder="Type your response here..."
                          required={field.required}
                        />
                        <div className="flex justify-end pr-1">
                          <span className="text-[11px] tabular-nums text-muted">
                            {(answers[field.id] ?? "").length} characters
                          </span>
                        </div>
                      </div>
                    ) : field.type === "select" ? (
                      <div className="relative">
                        <select
                          id={id}
                          className={`${baseInputClasses} appearance-none px-4 pr-10 ${getInputStateClasses(hasErr, isOk)}`}
                          value={answers[field.id] ?? ""}
                          onChange={(event) => setAnswer(field.id, event.target.value)}
                          onBlur={() => handleBlur(field.id)}
                          required={field.required}
                        >
                          <option value="">Choose…</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted"
                          aria-hidden
                        />
                      </div>
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
                              onClick={() => {
                                setAnswer(field.id, option);
                                handleBlur(field.id);
                              }}
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
                      <div className="relative flex items-center">
                        {field.type === "number" && (
                          <Hash
                            className="pointer-events-none absolute left-4 size-4.5 text-muted/70"
                            aria-hidden
                          />
                        )}
                        <input
                          id={id}
                          type={field.type === "number" ? "number" : "text"}
                          className={`${baseInputClasses} ${field.type === "number" ? "pl-11 pr-10" : "px-4"} ${getInputStateClasses(hasErr, isOk)}`}
                          value={answers[field.id] ?? ""}
                          onChange={(event) => setAnswer(field.id, event.target.value)}
                          onBlur={() => handleBlur(field.id)}
                          required={field.required}
                        />
                        {isOk && field.type === "number" && (
                          <Check
                            className="pointer-events-none absolute right-3.5 size-4 text-emerald-500"
                            aria-hidden
                          />
                        )}
                      </div>
                    )}
                  </FieldShell>
                );
              })}

              {/* Consent Box */}
              <div>
                <label
                  id={`${formId}-consent`}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                    fieldErrors["consent"] && touched["consent"]
                      ? "border-rose-400 bg-rose-500/[0.03]"
                      : "border-border bg-foreground/[0.02] hover:bg-foreground/[0.035]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => {
                      setConsent(event.target.checked);
                      clearFieldError("consent");
                    }}
                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="text-[13px] leading-6 text-muted">
                    I agree to my details and resume being stored for this role and used to assess my
                    application.
                  </span>
                </label>
                {fieldErrors["consent"] && touched["consent"] && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                    <span>{fieldErrors["consent"]}</span>
                  </p>
                )}
              </div>
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
              {submitting ? (
                <>
                  <Loader2 className="size-4.5 animate-spin" aria-hidden />
                  <span>Sending application…</span>
                </>
              ) : preview ? (
                "Preview only"
              ) : (
                <>
                  <span>Send application</span>
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </>
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
