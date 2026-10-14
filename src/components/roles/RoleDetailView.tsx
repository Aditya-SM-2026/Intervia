"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InterviewStatus, HumanDecision } from "@/lib/interviews/interview.types";
import type { RoleStatus, RoleSummary } from "@/lib/roles/role.types";
import type { RoleCandidateSummary, RoleCandidatesResponse, RoleResponse } from "@/lib/roles/role.types";

/**
 * One role: its details, a complete/close action, and every candidate with
 * their real interview state and scores. Loads through the roles API.
 */

const STATUS_LABELS: Record<RoleStatus, string> = { open: "Open", completed: "Completed" };

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

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RoleDetailView({ roleId }: { roleId: string }) {
  const router = useRouter();
  const [role, setRole] = useState<RoleSummary | null>(null);
  const [candidates, setCandidates] = useState<RoleCandidateSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function loadRole() {
    fetch(`/api/roles/${roleId}`)
      .then(async (response) => {
        const body = (await response.json()) as RoleResponse & { error?: { message?: string } };
        if (!response.ok || !body.role) {
          throw new Error(body.error?.message ?? "Could not load this role.");
        }
        setRole(body.role);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  function loadCandidates() {
    fetch(`/api/roles/${roleId}/candidates?limit=${PAGE_SIZE}&offset=${offset}`)
      .then(async (response) => {
        const body = (await response.json()) as RoleCandidatesResponse & { error?: { message?: string } };
        if (!response.ok || !body.candidates) {
          throw new Error(body.error?.message ?? "Could not load the candidates.");
        }
        setCandidates(body.candidates);
        setTotal(body.total);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  useEffect(() => {
    loadRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, offset]);

  async function markCompleted() {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not update the role.");
      }
      setConfirmingClose(false);
      setNotice("Role marked as completed.");
      await loadRole();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
    } finally {
      setActionBusy(false);
    }
  }

  function exportCsv() {
    // Trigger the CSV download without navigating away from the page.
    const link = document.createElement("a");
    link.href = `/api/roles/${roleId}/candidates/export`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (error && role === null) {
    return (
      <div>
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href="/dashboard/roles" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ← Back to roles
        </Link>
      </div>
    );
  }

  if (role === null) {
    return (
      <div aria-hidden className="space-y-4">
        <div className="h-28 animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />
      </div>
    );
  }

  return (
    <div>
      <Link href="/dashboard/roles" className="text-sm font-medium text-accent hover:underline">
        ← Back to roles
      </Link>

      <div className="mt-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">{role.title}</h2>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              role.status === "open"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-border bg-surface text-muted"
            }`}
          >
            {STATUS_LABELS[role.status]}
          </span>
          <span className="grow" />
          {role.status === "open" && (
            <button
              type="button"
              onClick={() => setConfirmingClose(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Mark completed
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Export CSV
          </button>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm text-muted">{role.description}</p>
        {role.skills.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {role.skills.map((skill) => (
              <span key={skill} className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                {skill}
              </span>
            ))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          {role.deadline && <span>Deadline {formatDate(role.deadline)}</span>}
          <span>
            <strong className="text-foreground">{role.stats.candidates}</strong> candidates ·{" "}
            <strong className="text-foreground">{role.stats.interviews}</strong> interviews ·{" "}
            <strong className="text-foreground">{role.stats.completed}</strong> scored ·{" "}
            <strong className="text-foreground">{role.stats.pending}</strong> pending
          </span>
          {role.stats.avgOverallScore !== null && (
            <span>
              Avg score <strong className="text-foreground">{role.stats.avgOverallScore}</strong>/100
            </span>
          )}
        </div>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {confirmingClose && (
        <div role="dialog" aria-label="Mark role completed?" className="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Mark this role as completed?</p>
          <p className="mt-1 text-sm text-muted">
            The role stays readable and exportable; you can reopen it at any time.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={markCompleted}
              disabled={actionBusy}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {actionBusy ? "Saving…" : "Yes, mark completed"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClose(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <h3 className="mt-8 text-lg font-semibold">Candidates</h3>
      {candidates === null ? (
        <div aria-hidden className="mt-3 space-y-2">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-14 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No candidates have been invited to interview for this role yet.
          {" "}
          <Link href="/recruiter" className="font-medium text-accent hover:underline">
            Create an interview link
          </Link>{" "}
          with this role&apos;s title and it will appear here.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2">Candidate</th>
                <th scope="col" className="px-3 py-2">Interviews</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Score</th>
                <th scope="col" className="px-3 py-2">Evaluation</th>
                <th scope="col" className="px-3 py-2">Decision</th>
                <th scope="col" className="px-3 py-2">Last interview</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.candidateId} className="rounded-lg bg-surface [&>td]:first:rounded-l-lg [&>td]:last:rounded-r-lg">
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                    <span className="block text-xs text-muted">{candidate.candidateEmail}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {candidate.completed}/{candidate.interviews} scored
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${INTERVIEW_STATUS_STYLES[candidate.latestStatus]}`}>
                      {INTERVIEW_STATUS_LABELS[candidate.latestStatus]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium">
                    {candidate.overallScore === null ? "—" : `${candidate.overallScore}/100`}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {candidate.suggestion ? SUGGESTION_LABELS[candidate.suggestion] : <span className="text-muted">Not scored</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {candidate.decision ? DECISION_LABELS[candidate.decision.outcome] : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{formatDate(candidate.latestInterviewAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href={`/dashboard/roles/${roleId}/candidates/${encodeURIComponent(candidate.candidateId)}`}
                      className="font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - PAGE_SIZE));
                    router.refresh();
                  }}
                  className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => {
                    setOffset(offset + PAGE_SIZE);
                    router.refresh();
                  }}
                  className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
                >
                  Next
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}