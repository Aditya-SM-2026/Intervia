"use client";

import { useEffect, useRef, useState } from "react";
import type { InterviewRoom } from "@/lib/interviews/interview.types";

interface InterviewLinkResultProps {
  result: {
    room: InterviewRoom;
    candidateUrl: string;
  };
  onReset: () => void;
}

const COPY_FEEDBACK_MS = 2000;

export function InterviewLinkResult({ result, onReset }: InterviewLinkResultProps) {
  const { room, candidateUrl } = result;
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

      <div>
        <p className="mb-1 text-sm font-medium">Candidate link</p>
        <input
          type="text"
          readOnly
          value={candidateUrl}
          aria-label="Candidate link"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        {manualCopyNeeded && (
          <p className="mt-1 text-xs text-muted">
            Automatic copy is not available — select the link above and copy it
            manually.
          </p>
        )}
      </div>

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
        Share this link only with the candidate. Anyone who has it can join the
        interview room{room.expiresAt ? ` until ${formatDateTime(room.expiresAt)}` : ""}.
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