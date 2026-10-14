"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HumanDecision } from "@/lib/interviews/interview.types";
import type { RoleStatus, RoleSummary } from "@/lib/roles/role.types";
import type { RoleCandidateSummary, RoleCandidatesResponse, RoleResponse } from "@/lib/roles/role.types";
import {
  compareByHirePriority,
  deriveHireStage,
  HIRE_STAGE_LABELS,
  HIRE_STAGE_STYLES,
  type HireStage,
} from "@/lib/roles/hire-stage";

/**
 * HR leaderboard for one role: candidates ranked the way a recruiter reads a
 * shortlist — actionable stages first, highest scores on top — with a score
 * cutoff filter and one-click bulk advance/hold/reject. Every number and
 * stage comes from the roles API; nothing is invented.
 */

const STATUS_LABELS: Record<RoleStatus, string> = { open: "Open", completed: "Completed" };

const SUGGESTION_LABELS: Record<string, string> = {
  strong: "Strong",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Insufficient",
};

const DECISION_LABELS: Record<HumanDecision["outcome"], string> = {
  advance: "Advanced",
  hold: "On hold",
  reject: "Rejected",
};

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface LeaderRow {
  candidate: RoleCandidateSummary;
  stage: HireStage;
}

export function RoleDetailView({ roleId }: { roleId: string }) {
  const router = useRouter();
  const [role, setRole] = useState<RoleSummary | null>(null);
  const [candidates, setCandidates] = useState<RoleCandidateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState("");
  const [cutoffApplied, setCutoffApplied] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDecision, setConfirmingDecision] = useState<HumanDecision["outcome"] | null>(null);

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
    fetch(`/api/roles/${roleId}/candidates?limit=${PAGE_SIZE}&offset=0`)
      .then(async (response) => {
        const body = (await response.json()) as RoleCandidatesResponse & { error?: { message?: string } };
        if (!response.ok || !body.candidates) {
          throw new Error(body.error?.message ?? "Could not load the candidates.");
        }
        setCandidates(body.candidates);
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
  }, [roleId]);

  /** Ranked rows: recruiter-set decisions first, then ready-to-advance, then by score. */
  const rows = useMemo<LeaderRow[]>(() => {
    if (candidates === null) return [];
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        stage: deriveHireStage({
          status: candidate.latestStatus,
          overallScore: candidate.overallScore,
          decision: candidate.decision?.outcome ?? null,
          cutoff: cutoffApplied,
        }),
      }))
      .sort((a, b) =>
        compareByHirePriority(
          { stage: a.stage, overallScore: a.candidate.overallScore },
          { stage: b.stage, overallScore: b.candidate.overallScore },
        ),
      );
    if (cutoffApplied === null) return ranked;
    return ranked.filter(
      (row) =>
        row.candidate.overallScore === null || row.candidate.overallScore >= cutoffApplied,
    );
  }, [candidates, cutoffApplied]);

  const readyCount = rows.filter((row) => row.stage === "ready-to-advance" || row.stage === "advanced").length;

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

  async function applyDecision(outcome: HumanDecision["outcome"]) {
    if (actionBusy || selected.size === 0) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/roles/${roleId}/candidates/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: outcome, candidateIds: [...selected] }),
      });
      const body = (await response.json()) as {
        decided?: { decided: number }[];
        failed?: { error: string }[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not record the decisions.");
      const okCount = body.decided?.length ?? 0;
      const failCount = body.failed?.length ?? 0;
      setNotice(
        failCount === 0
          ? `${okCount} candidate${okCount === 1 ? "" : "s"} marked "${DECISION_LABELS[outcome]}".`
          : `${okCount} marked "${DECISION_LABELS[outcome]}" · ${failCount} failed: ${body.failed?.[0]?.error ?? ""}`,
      );
      setSelected(new Set());
      setConfirmingDecision(null);
      loadCandidates();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
    } finally {
      setActionBusy(false);
    }
  }

  function toggle(candidateId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.candidate.candidateId));

  function exportCsv() {
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
            <strong className="text-foreground">{role.stats.completed}</strong> completed ·{" "}
            <strong className="text-foreground">{role.stats.pending}</strong> pending
          </span>
          {role.stats.avgOverallScore !== null && (
            <span>
              Avg score <strong className="text-foreground">{role.stats.avgOverallScore}</strong>/100
            </span>
          )}
          {cutoffApplied !== null && (
            <span className="text-accent">
              Shortlist cutoff ≥ {cutoffApplied}: <strong className="text-accent">{readyCount}</strong> ready
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

      {/* ---------------------------------------------------------- leaderboard */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold">
          Candidates <span className="text-sm font-normal text-muted">ranked to hire</span>
        </h3>
        <span className="grow" />
        <label className="flex items-center gap-2 text-xs text-muted">
          Shortlist cutoff
          <input
            type="number"
            min={0}
            max={100}
            value={cutoff}
            onChange={(event) => setCutoff(event.target.value)}
            placeholder="≥ score"
            aria-label="Shortlist score cutoff"
            className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            onClick={() => {
              const parsed = Number.parseInt(cutoff, 10);
              setCutoffApplied(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : null);
              setSelected(new Set());
            }}
            className="rounded-md border border-border px-2 py-1 font-medium transition hover:border-accent/50"
          >
            Apply
          </button>
          {cutoffApplied !== null && (
            <button
              type="button"
              onClick={() => {
                setCutoffApplied(null);
                setCutoff("");
                setSelected(new Set());
              }}
              className="font-medium text-accent hover:underline"
            >
              Clear
            </button>
          )}
        </label>
      </div>

      {candidates === null ? (
        <div aria-hidden className="mt-3 space-y-2">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-14 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          {candidates.length === 0
            ? "No candidates have been invited to interview for this role yet."
            : "No candidates meet this cutoff yet."}{" "}
          {candidates.length === 0 && (
            <Link href="/recruiter" className="font-medium text-accent hover:underline">
              Create an interview link
            </Link>
          )}
        </div>
      ) : (
        <>
          {selected.size > 0 && (
            <div role="toolbar" aria-label="Bulk decisions" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
              <span className="text-sm font-medium">
                {selected.size} selected
              </span>
              <span className="grow" />
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setConfirmingDecision("advance")}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                Advance
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setConfirmingDecision("hold")}
                className="rounded-md border border-amber-500/60 px-3 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 disabled:opacity-60 dark:text-amber-300"
              >
                Hold
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setConfirmingDecision("reject")}
                className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-sm text-muted hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}

          {confirmingDecision !== null && (
            <div role="dialog" aria-label="Confirm bulk decision" className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
              <p className="text-sm font-medium">
                {confirmingDecision === "advance" ? "Advance" : confirmingDecision === "hold" ? "Put on hold" : "Reject"}{" "}
                {selected.size} candidate{selected.size === 1 ? "" : "s"}?
              </p>
              <p className="mt-1 text-sm text-muted">
                The decision is recorded on each candidate&apos;s most recent interview and they move to the matching stage. You can change it later.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => applyDecision(confirmingDecision)}
                  disabled={actionBusy}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {actionBusy ? "Recording…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDecision(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-y-1 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all candidates"
                      checked={allSelected}
                      onChange={() => {
                        setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.candidate.candidateId)));
                      }}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2">Candidate</th>
                  <th scope="col" className="px-3 py-2">Score</th>
                  <th scope="col" className="px-3 py-2">Stage</th>
                  <th scope="col" className="px-3 py-2">Evaluation</th>
                  <th scope="col" className="px-3 py-2">Decision</th>
                  <th scope="col" className="px-3 py-2">Last interview</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ candidate, stage }) => (
                  <tr
                    key={candidate.candidateId}
                    className={`rounded-lg bg-surface [&>td]:first:rounded-l-lg [&>td]:last:rounded-r-lg ${
                      selected.has(candidate.candidateId) ? "ring-1 ring-accent/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${candidate.candidateName ?? candidate.candidateEmail}`}
                        checked={selected.has(candidate.candidateId)}
                        onChange={() => toggle(candidate.candidateId)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                      <span className="block text-xs text-muted">{candidate.candidateEmail}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {candidate.overallScore === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="font-semibold">{candidate.overallScore}<span className="text-xs font-normal text-muted">/100</span></span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HIRE_STAGE_STYLES[stage]}`}>
                        {HIRE_STAGE_LABELS[stage]}
                      </span>
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
          </div>
        </>
      )}
    </div>
  );
}