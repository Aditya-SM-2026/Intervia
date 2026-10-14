"use client";

import { useEffect, useState } from "react";

type UploadInfo = {
  roleTitle: string | null;
  recruiterName: string | null;
  candidateName: string | null;
  scheduledAt: string | null;
  valid: boolean;
  expiresAt: string;
  alreadyUsed: boolean;
  resumeReceived: boolean;
};

const inputClasses =
  "h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

export function ResumeUploadForm({ token }: { token: string }) {
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/upload/${token}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: UploadInfo | null) => {
        setInfo(data);
        if (!data) setError("This upload link is not valid.");
      })
      .catch(() => setError("This upload link is not valid."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose your resume file first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("resume", file);
      const response = await fetch(`/api/upload/${token}`, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? "The upload failed. Please try again.");
        return;
      }
      setDone(file.name);
      setFile(null);
    } catch {
      setError("The upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (!info) {
    return (
      <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (info.alreadyUsed || (done !== null && info.resumeReceived)) {
    return (
      <div className="grid gap-2">
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          Your resume has been received. You can close this page.
        </p>
      </div>
    );
  }

  if (!info.valid) {
    return (
      <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        This upload link has expired. Please ask your recruiter for a new one.
      </p>
    );
  }

  const when = info.scheduledAt
    ? new Date(info.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className="grid gap-5">
      <div className="grid gap-1 text-sm">
        {info.candidateName && <p>Hi <span className="font-medium">{info.candidateName}</span>,</p>}
        <p className="text-muted">
          Please upload your resume for the interview
          {info.roleTitle ? <> for the <span className="font-medium">{info.roleTitle}</span> role</> : null}
          {info.recruiterName ? <> arranged by {info.recruiterName}</> : null}
          {when ? <> scheduled for <span className="font-medium">{when}</span></> : null}.
        </p>
      </div>

      {done ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <span className="font-medium">{done}</span> uploaded. Thank you — you can close this page.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div>
            <label htmlFor="resume-file" className="mb-1.5 block text-sm font-medium">
              Resume (PDF, DOC or DOCX, up to 10 MB)
            </label>
            <input
              id="resume-file"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className={inputClasses}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !file}
            className="h-11 rounded-lg bg-accent px-5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Uploading…" : "Upload resume"}
          </button>
          <p className="text-xs text-muted">
            This link works only once and expires by{" "}
            {new Date(info.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        </form>
      )}
    </div>
  );
}