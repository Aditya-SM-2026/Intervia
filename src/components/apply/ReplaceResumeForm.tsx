"use client";

import { Check, FileText, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
 * Replaces the resume on an application that was already sent. Nothing else
 * on the application changes, so the candidate does not fill the form again.
 */
export function ReplaceResumeForm({
  updateToken,
  currentFileName,
  lastUpdatedAt,
}: {
  updateToken: string;
  currentFileName: string | null;
  lastUpdatedAt: string | null;
}) {
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<{ fileName: string; updatedAt: string } | null>(null);

  async function replaceResume() {
    if (submitting) return;
    setError(null);
    if (!file) {
      setError("Choose the corrected resume first.");
      return;
    }

    const body = new FormData();
    body.set("resume", file);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/apply/resume/${encodeURIComponent(updateToken)}`, {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; fileName?: string; updatedAt?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error?.message ?? "Could not replace your resume. Please try again.");
      }
      setSaved({
        fileName: data.fileName ?? file.name,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not replace your resume.");
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    return (
      <div className="mt-6 rounded-2xl border border-border bg-surface p-8 text-center shadow-sm shadow-black/[0.03] sm:p-10">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <Check className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">New resume saved</h1>
        <p className="mt-2 text-sm text-muted">
          The hiring team now sees <strong className="text-foreground">{saved.fileName}</strong> on
          your application. Nothing else you filled in has changed.
        </p>
        <button
          type="button"
          onClick={() => setSaved(null)}
          className="mt-5 text-sm font-medium text-accent hover:underline"
        >
          Upload a different file
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/[0.03] sm:p-8">
      <p className="text-sm text-muted">Replace your resume</p>

      <div className="mt-5 rounded-xl border border-border bg-background/50 px-3.5 py-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted">Currently on your application</p>
        <p className="mt-1 flex items-center gap-2 font-medium">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 truncate">{currentFileName ?? "No file on record"}</span>
        </p>
        {lastUpdatedAt && (
          <p className="mt-1 text-xs text-muted">
            Last replaced {new Date(lastUpdatedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="mt-5">
        <input
          ref={fileRef}
          id={`${formId}-resume`}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            const problem = picked ? resumeProblem(picked) : null;
            if (problem) {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
              setError(problem);
              return;
            }
            setError(null);
            setFile(picked);
          }}
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
            >
              <FileText className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{file.name}</span>
              <span className="block text-xs text-muted">{formatBytes(file.size)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
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
            <span className="font-medium text-accent">Choose the corrected resume</span>
            <span className="text-muted">PDF, DOC or DOCX up to 10 MB</span>
          </label>
        )}
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
        type="button"
        onClick={() => void replaceResume()}
        disabled={submitting}
        className="mt-6 h-12 w-full rounded-xl bg-accent text-[15px] font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {submitting ? "Saving…" : "Save new resume"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        Only the resume changes. Your details and answers stay as they are.
      </p>
    </div>
  );
}
