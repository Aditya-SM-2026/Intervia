"use client";

import { useEffect, useRef, useState } from "react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";

interface InterviewLinkResultProps {
  result: {
    room: InterviewRoom;
    candidateUrl: string;
    uploadUrl?: string | null;
    inviteEmail?: {
      status: "sent" | "failed" | "not_configured";
      detail?: string;
    };
  };
  onReset: () => void;
}

const COPY_FEEDBACK_MS = 2000;

export function InterviewLinkResult({ result, onReset }: InterviewLinkResultProps) {
  const { room, candidateUrl, uploadUrl, inviteEmail } = result;
  const [copied, setCopied] = useState(false);
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

  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-semibold">Interview created</h2>

      <p className="text-sm">
        <span className="font-medium">{room.title}</span>
        {room.candidateName && <> for candidate {room.candidateName}</>}.
      </p>

      {inviteEmail && (
        <p className="text-sm">
          {inviteEmail.status === "sent" && (
            <span className="text-muted">
              Invitation email sent to <span className="font-medium">{room.candidateEmail}</span>.
            </span>
          )}
          {inviteEmail.status === "failed" && (
            <span className="text-amber-600 dark:text-amber-400">
              Invitation email could not be sent — copy the link above and share it with{" "}
              <span className="font-medium">{room.candidateEmail}</span> yourself.
            </span>
          )}
          {inviteEmail.status === "not_configured" && (
            <span className="text-muted">
              Email sending is not configured — copy the link above and share it with{" "}
              <span className="font-medium">{room.candidateEmail}</span>.
            </span>
          )}
        </p>
      )}

      {room.scheduledAt && (
        <p className="text-sm">
          <span className="font-medium">Scheduled for</span>{" "}
          {new Date(room.scheduledAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}{" "}
          <span className="text-muted">(your local time)</span>
        </p>
      )}

      <div>
        <p className="mb-1 text-sm font-medium">Candidate link</p>
        <input
          type="text"
          readOnly
          value={candidateUrl}
          aria-label="Candidate link"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
        />
        {manualCopyNeeded && (
          <p className="mt-1 text-xs text-muted">
            Automatic copy is not available — select the link above and copy it
            manually.
          </p>
        )}
      </div>

      {uploadUrl && !room.resume && (
        <div>
          <p className="mb-1 text-sm font-medium">Resume upload link for the candidate</p>
          <input
            type="text"
            readOnly
            value={uploadUrl}
            aria-label="Resume upload link"
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            The candidate can upload their resume (PDF, DOC, DOCX) here; the link works once
            and expires after 24 hours.
          </p>
        </div>
      )}

      {room.plan && (
        <div>
          <p className="mb-1 text-sm font-medium">
            Interview plan: {room.durationMinutes} minutes, {room.plan.competencies.length} topics,{" "}
            {room.voiceMode === "rolling" ? "lower-cost voice" : "standard voice"}
          </p>
          {room.plan.source === "fallback" && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
              A tailored plan could not be generated, so a generic plan is used. Create the
              interview again to retry.
            </p>
          )}
          <ol className="grid list-decimal gap-2 rounded-lg border border-border bg-background py-3 pl-8 pr-3 text-sm">
            {room.plan.competencies.map((competency) => (
              <li key={competency.id}>
                <span className="font-medium">{competency.name}.</span>{" "}
                <span className="text-muted">{competency.question}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <a
          href={candidateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          Open candidate link
        </a>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:text-foreground"
        >
          Create another
        </button>
      </div>

      <p className="text-xs text-muted">
        Share this link only with the candidate. It opens only for the invited email
        address{room.expiresAt ? `, until ${formatDateTime(room.expiresAt)}` : ""}. The scorecard
        appears on the dashboard when the interview ends.
      </p>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}