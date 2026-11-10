"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";

interface InterviewLinkResultProps {
  result: {
    room: InterviewRoom;
    candidateUrl: string;
    hrUrl?: string | null;
    uploadUrl?: string | null;
    inviteEmail?: {
      status: "sent" | "failed" | "not_configured";
      detail?: string;
    };
    hrInviteEmail?: {
      status: "sent" | "failed" | "not_configured";
      detail?: string;
    } | null;
  };
  onReset: () => void;
}

const COPY_FEEDBACK_MS = 2000;

export function InterviewLinkResult({ result, onReset }: InterviewLinkResultProps) {
  const { room, candidateUrl, hrUrl, uploadUrl, inviteEmail, hrInviteEmail } = result;
  const [copied, setCopied] = useState(false);
  const [hrCopied, setHrCopied] = useState(false);
  const [manualCopyNeeded, setManualCopyNeeded] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(candidateUrl);
      setManualCopyNeeded(false);
      setCopied(true);
      copyTimer.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      setManualCopyNeeded(true);
    }
  }

  async function handleCopyHr() {
    if (!hrUrl) return;
    try {
      await navigator.clipboard.writeText(hrUrl);
      setHrCopied(true);
      copyTimer.current = window.setTimeout(() => setHrCopied(false), COPY_FEEDBACK_MS);
    } catch {
      setManualCopyNeeded(true);
    }
  }

  const emailLine =
    inviteEmail?.status === "sent"
      ? { tone: "text-muted", text: `Invitation emailed to ${room.candidateEmail}.` }
      : inviteEmail?.status === "failed"
        ? { tone: "text-amber-700 dark:text-amber-400", text: `The email to ${room.candidateEmail} did not go through. Copy the link and send it yourself.` }
        : inviteEmail?.status === "not_configured"
          ? { tone: "text-muted", text: `Email is not set up here. Copy the link and send it to ${room.candidateEmail}.` }
          : null;

  return (
    <div className="grid gap-7">
      <div className="flex items-start gap-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <Check className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Interview ready</h2>
          <p className="mt-1 text-sm text-muted">
            {room.title}
            {room.candidateName ? ` for ${room.candidateName}` : ""}
            {room.expiresAt ? `. The link works until ${formatDateTime(room.expiresAt)}.` : "."}
          </p>
          {emailLine && <p className={`mt-1 text-sm ${emailLine.tone}`}>{emailLine.text}</p>}
          {room.scheduledAt && (
            <p className="mt-1 text-sm text-muted">
              Scheduled for {new Date(room.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Candidate link</p>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-background/50 p-1 pl-3.5">
          <input
            type="text"
            readOnly
            value={candidateUrl}
            aria-label="Candidate link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-sm text-muted outline-none"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {manualCopyNeeded && (
          <p className="mt-1.5 text-xs text-muted">Copying is blocked in this browser. Select the link and copy it by hand.</p>
        )}
        <p className="mt-1.5 text-xs text-muted">It opens only for the invited email address.</p>
      </div>

      {hrUrl && (
        <div>
          <p className="mb-1.5 text-sm font-medium">HR link</p>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background/50 p-1 pl-3.5">
            <input
              type="text"
              readOnly
              value={hrUrl}
              aria-label="HR link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-sm text-muted outline-none"
            />
            <button
              type="button"
              onClick={handleCopyHr}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition hover:bg-accent/90"
            >
              {hrCopied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {hrCopied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {hrInviteEmail?.status === "sent"
              ? `Emailed to ${room.hrEmail}.`
              : hrInviteEmail?.status === "failed"
                ? `The email to ${room.hrEmail} did not go through. Copy the link and send it yourself.`
                : hrInviteEmail?.status === "not_configured"
                  ? `Email is not set up here. Copy the link and send it to ${room.hrEmail}.`
                  : "Joining is optional. HR can listen and speak to the candidate."}
          </p>
        </div>
      )}

      {uploadUrl && !room.resume && (
        <div>
          <p className="mb-1.5 text-sm font-medium">Resume upload link</p>
          <input
            type="text"
            readOnly
            value={uploadUrl}
            aria-label="Resume upload link"
            onFocus={(event) => event.currentTarget.select()}
            className="h-10 w-full rounded-xl border border-border bg-background/50 px-3.5 text-sm text-muted outline-none"
          />
          <p className="mt-1.5 text-xs text-muted">For the candidate to add a resume. Works once, for 24 hours.</p>
        </div>
      )}

      {room.plan && (
        <div className="border-t border-border pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold">The plan</h3>
            <p className="text-sm text-muted">
              {room.durationMinutes} minutes, {room.plan.competencies.length} topics
            </p>
          </div>
          {room.plan.source === "fallback" && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              A plan tailored to this job could not be made, so a general one is used. Create the interview again to retry.
            </p>
          )}
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {room.plan.competencies.map((competency, index) => (
              <li key={competency.id} className="grid grid-cols-[1.75rem_1fr] gap-x-2 py-3.5 text-sm">
                <span className="tabular-nums text-muted">{index + 1}</span>
                <span>
                  <span className="block font-medium">{competency.name}</span>
                  <span className="mt-0.5 block leading-6 text-muted">{competency.question}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={candidateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]"
        >
          <ExternalLink className="size-4 text-muted" aria-hidden />
          Open as candidate
        </a>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
        >
          Create another
        </button>
        <span className="grow" />
        <span className="text-xs text-muted">The report appears on Interviews when it ends.</span>
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}