"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InterviewStatus, HumanDecision } from "@/lib/interviews/interview.types";
import type {
  CandidateInterviewDetail,
  RoleCandidateResponse,
} from "@/lib/roles/role.types";

/**
 * One candidate inside one role: profile, resume, and every interview with
 * its real score. Detailed scorecards open in the existing interview view.
 */

const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Not started",
  waiting: "Waiting",
  active: "In progress",
  completed: "Completed",
  expired: "Link expired",
  cancelled: "Cancelled",
};

const INTERVIEW_STATUS_STYLES: Record<InterviewStatus, string> = {
  scheduled: "border-border bg-surface text-muted",
  waiting: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  expired: "border-border bg-surface text-muted",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

const DECISION_LABELS: Record<HumanDecision["outcome"], string> = {
  advance: "Advanced",
  hold: "On hold",
  reject: "Rejected",
};

const SUGGESTION_LABELS: Record<string, string> = {
  strong: "Strong",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Insufficient",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CandidateDetailView({
  roleId,
  candidateId,
}: {
  roleId: string;
  candidateId: string;
}) {
  const [candidate, setCandidate] = useState<RoleCandidateResponse["candidate"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch(`/api/roles/${roleId}/candidates/${encodeURIComponent(candidateId)}`)
      .then(async (response) => {
        const body = (await response.json()) as RoleCandidateResponse & { error?: { message?: string } };
        if (!response.ok || !body.candidate) {
          throw new Error(body.error?.message ?? "Could not load this candidate.");
        }
        setCandidate(body.candidate);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  useEffect(() => {
    load();
    // Reload when the route params change; load is stable for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, candidateId]);

  if (error && candidate === null) {
    return (
      <div>
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href={`/dashboard/roles/${roleId}`} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ← Back to role
        </Link>
      </div>
    );
  }

  if (candidate === null) {
    return (
      <div aria-hidden className="space-y-4">
        <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-48 animate-pulse rounded-lg border border-border bg-surface" />
      </div>
    );
  }

  const scoredInterviews = candidate.interviews.filter((interview) => interview.overallScore !== null);
  const bestScore =
    scoredInterviews.length > 0
      ? Math.max(...scoredInterviews.map((interview) => interview.overallScore ?? 0))
      : null;

  return (
    <div>
      <Link href={`/dashboard/roles/${roleId}`} className="text-sm font-medium text-accent hover:underline">
        ← Back to {candidate.role.title}
      </Link>

      <div className="mt-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">{candidate.candidateName ?? "Unnamed candidate"}</h2>
          {bestScore !== null && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Best score {bestScore}/100
            </span>
          )}
          <span className="grow" />
          {candidate.resume?.hasText && (
            <a
              href={`/api/roles/${roleId}/candidates/${encodeURIComponent(candidateId)}/resume`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Download resume
            </a>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {candidate.candidateEmail} · interviewing for {candidate.role.title}
        </p>
        {candidate.resume === null && (
          <p className="mt-2 text-xs text-muted">No resume was attached to this candidate&apos;s interviews.</p>
        )}
      </div>

      <h3 className="mt-8 text-lg font-semibold">Interview history</h3>
      {candidate.interviews.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No interviews found for this candidate in this role.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {candidate.interviews.map((interview: CandidateInterviewDetail) => (
            <li key={interview.roomId} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{interview.title || "Interview"}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${INTERVIEW_STATUS_STYLES[interview.status]}`}>
                  {INTERVIEW_STATUS_LABELS[interview.status]}
                </span>
                {interview.needsHumanReview && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                    Needs human review
                  </span>
                )}
                <span className="grow" />
                {interview.overallScore !== null && (
                  <span className="text-sm font-semibold">{interview.overallScore}/100</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                Started {formatDateTime(interview.createdAt)}
                {interview.completedAt ? ` · ended ${formatDateTime(interview.completedAt)}` : ""}
                {interview.suggestion ? ` · ${SUGGESTION_LABELS[interview.suggestion]}` : ""}
                {interview.decision ? ` · ${DECISION_LABELS[interview.decision.outcome]}` : ""}
              </p>
              <div className="mt-2">
                {interview.status === "completed" ? (
                  <Link
                    href={`/dashboard/${interview.roomId}`}
                    className="text-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Open full report →
                  </Link>
                ) : (
                  <span className="text-xs text-muted">
                    {interview.overallScore === null
                      ? "The scorecard appears when this interview completes."
                      : "Full report available after completion."}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}