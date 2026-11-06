"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { HumanDecision, InterviewStatus } from "@/lib/interviews/interview.types";
import type {
  RoleCandidateSummary,
  RoleCandidatesResponse,
  RoleResponse,
  RoleStatus,
  RoleSummary,
} from "@/lib/roles/role.types";
import {
  compareByHirePriority,
  deriveApplicationStage,
  deriveHireStage,
  HIRE_STAGE_LABELS,
  HIRE_STAGE_STYLES,
  type HireStage,
} from "@/lib/roles/hire-stage";
import { ApplicationFormSettings } from "@/components/roles/ApplicationFormSettings";
import { Pagination } from "@/components/dashboard/Pagination";
import {
  compareCandidateRows,
  type CandidateSortKey,
  type SortState,
} from "@/lib/roles/candidate-sort";
import type { ApplicationField } from "@/lib/roles/application.types";

/**
 * HR leaderboard for one role. Candidates are split into the two stages a
 * recruiter acts on — applications to review, and interviews to score — with
 * live counts, search, stage filters, sortable columns and pagination.
 * Every number and stage comes from the roles API; nothing is invented.
 */

/**
 * Long job descriptions start collapsed to four lines with a Read more
 * toggle, so the candidate list stays the focus of the page.
 */
function CollapsibleDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  // Long enough descriptions are worth collapsing; anything shorter shows in full.
  const collapsible = text.length > 280 || text.split("\n").length > 4;
  return (
    <div className="mt-2">
      <p
        className={`whitespace-pre-line text-sm text-muted ${
          collapsible && !expanded ? "line-clamp-4" : ""
        }`}
      >
        {text}
      </p>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="mt-1 text-sm font-medium text-accent hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

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

const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  waiting: "In progress",
  active: "In progress",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const INTERVIEW_STATUS_STYLES: Record<InterviewStatus, string> = {
  scheduled: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  waiting: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  expired: "bg-border/60 text-muted",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const PAGE_SIZE = 25;

type StageTab = "applications" | "interviews";

function defaultSortFor(tab: StageTab): SortState {
  return tab === "applications"
    ? { key: "applied", direction: "desc" }
    : { key: "interview", direction: "desc" };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (score >= 50) return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
}

interface LeaderRow {
  candidate: RoleCandidateSummary;
  stage: HireStage;
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: CandidateSortKey;
  sort: SortState;
  onSort: (column: CandidateSortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-foreground"
        aria-label={`Sort by ${label}, ${active && sort.direction === "asc" ? "descending" : "ascending"}`}
      >
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp className="size-3.5" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
        )}
      </button>
    </th>
  );
}

export function RoleDetailView({ roleId }: { roleId: string }) {
  const [role, setRole] = useState<RoleSummary | null>(null);
  const [candidates, setCandidates] = useState<RoleCandidateSummary[] | null>(null);
  const [counts, setCounts] = useState<{ applied: number; interview: number }>({
    applied: 0,
    interview: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState("");
  const [cutoffApplied, setCutoffApplied] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDecision, setConfirmingDecision] = useState<HumanDecision["outcome"] | null>(null);
  const [formFields, setFormFields] = useState<ApplicationField[]>([]);
  const [openApplication, setOpenApplication] = useState<string | null>(null);

  const [tab, setTab] = useState<StageTab>("applications");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "scheduled" | "in-progress" | "completed" | "cancelled">("all");
  const [sort, setSort] = useState<SortState>(defaultSortFor("applications"));
  const [page, setPage] = useState(1);

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

  /**
   * Loads every candidate row for the role, page by page, so search, sorting
   * and pagination act on the whole list rather than one server page. Counts
   * come from the API and cover the whole role even if this loop is capped.
   */
  async function loadCandidates() {
    const collected: RoleCandidateSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let latestCounts: { applied: number; interview: number } | null = null;
    try {
      while (offset < total && offset < 2_000) {
        const response = await fetch(
          `/api/roles/${roleId}/candidates?limit=50&offset=${offset}`,
        );
        const body = (await response.json()) as RoleCandidatesResponse & {
          error?: { message?: string };
        };
        if (!response.ok || !body.candidates) {
          throw new Error(body.error?.message ?? "Could not load the candidates.");
        }
        collected.push(...body.candidates);
        total = body.total;
        latestCounts = body.counts ?? latestCounts;
        if (body.candidates.length === 0) break;
        offset += body.candidates.length;
      }
      setCandidates(collected);
      setCounts(
        latestCounts ?? {
          applied: collected.filter((candidate) => candidate.interviews === 0).length,
          interview: collected.filter((candidate) => candidate.interviews > 0).length,
        },
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  useEffect(() => {
    loadRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  /** Labels for the role's questions, so answers read as sentences. */
  useEffect(() => {
    fetch(`/api/roles/${roleId}/form-link`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { fields?: ApplicationField[] };
      })
      .then((body) => setFormFields(body?.fields ?? []))
      .catch(() => setFormFields([]));
  }, [roleId]);

  /** Rejects or restores an application from the form. */
  async function setApplicationStage(applicationId: string, action: "reject" | "restore") {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const response = await fetch(
        `/api/roles/${roleId}/applications/${encodeURIComponent(applicationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update the application.");
      setNotice(
        action === "reject"
          ? "Application rejected. The applicant moves to the Rejected stage."
          : "Application moved back to Waiting.",
      );
      loadCandidates();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
    } finally {
      setActionBusy(false);
    }
  }

  /** Ranked rows: recruiter-set decisions first, then ready-to-advance, then by score. */
  const rows = useMemo<LeaderRow[]>(() => {
    if (candidates === null) return [];
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        stage:
          candidate.applicationStatus && candidate.interviews === 0
            ? deriveApplicationStage(candidate.applicationStatus)
            : deriveHireStage({
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
        row.candidate.interviews === 0 ||
        row.candidate.overallScore === null ||
        row.candidate.overallScore >= cutoffApplied,
    );
  }, [candidates, cutoffApplied]);

  const appliedRows = useMemo(() => rows.filter((row) => row.candidate.interviews === 0), [rows]);
  const interviewRows = useMemo(() => rows.filter((row) => row.candidate.interviews > 0), [rows]);
  const readyCount = interviewRows.filter(
    (row) => row.stage === "ready-to-advance" || row.stage === "advanced",
  ).length;

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = tab === "applications" ? appliedRows : interviewRows;
    const filtered = source.filter((row) => {
      const candidate = row.candidate;
      if (needle) {
        const haystack = [
          candidate.candidateName ?? "",
          candidate.candidateEmail,
          candidate.candidatePhone ?? "—",
          candidate.candidateCollegeId ?? "—",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (tab === "interviews" && statusFilter !== "all") {
        const status = candidate.latestStatus;
        if (statusFilter === "scheduled" && status !== "scheduled") return false;
        if (statusFilter === "in-progress" && status !== "waiting" && status !== "active") {
          return false;
        }
        if (statusFilter === "completed" && status !== "completed") return false;
        if (
          statusFilter === "cancelled" &&
          status !== "cancelled" &&
          status !== "expired"
        ) {
          return false;
        }
      }
      return true;
    });
    return [...filtered].sort((a, b) => compareCandidateRows(a, b, sort));
  }, [appliedRows, interviewRows, query, tab, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function selectTab(next: StageTab) {
    setTab(next);
    setPage(1);
    setSelected(new Set());
    setSort(defaultSortFor(next));
    setStatusFilter("all");
  }

  function toggleSort(key: CandidateSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
    setPage(1);
  }

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

  const allSelected =
    pageRows.length > 0 && pageRows.every((row) => selected.has(row.candidate.candidateId));

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

  const activeRows = tab === "applications" ? appliedRows : interviewRows;

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
          <Link
            href={`/recruiter?roleId=${encodeURIComponent(role.id)}`}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Add candidate
          </Link>
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
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Export CSV
          </button>
        </div>
        <CollapsibleDescription text={role.description} />
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

      <ApplicationFormSettings
        roleId={roleId}
        roleTitle={role.title}
        roleDescription={role.description}
      />

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

      {/* ---------------------------------------------------------- candidates */}
      <div className="mt-8">
        <div
          role="tablist"
          aria-label="Candidate stages"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "applications"}
            aria-controls="applied-candidates"
            onClick={() => selectTab("applications")}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === "applications"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Applied Candidates ({counts.applied})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "interviews"}
            aria-controls="interview-candidates"
            onClick={() => selectTab("interviews")}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === "interviews"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Interview Candidates ({counts.interview})
          </button>
        </div>

        <div
          id={tab === "applications" ? "applied-candidates" : "interview-candidates"}
          role="tabpanel"
          className="pt-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:max-w-xs">
              <span className="sr-only">Search candidates</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by name, email or phone"
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>

            {tab === "interviews" && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => {
                      setStatusFilter(event.target.value as typeof statusFilter);
                      setPage(1);
                    }}
                    className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
                  >
                    <option value="all">All</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="in-progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled / expired</option>
                  </select>
                </label>

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
                      setCutoffApplied(
                        Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : null,
                      );
                      setSelected(new Set());
                      setPage(1);
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
                        setPage(1);
                      }}
                      className="font-medium text-accent hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </label>
              </>
            )}

            <span className="grow" />
            <span className="text-xs text-muted">
              {visibleRows.length} shown
            </span>
          </div>

          {selected.size > 0 && tab === "interviews" && (
            <div role="toolbar" aria-label="Bulk decisions" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
              <span className="text-sm font-medium">{selected.size} selected</span>
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

          {candidates === null ? (
            <div aria-hidden className="mt-3 space-y-2">
              {[0, 1, 2].map((key) => (
                <div key={key} className="h-14 animate-pulse rounded-lg border border-border bg-surface" />
              ))}
            </div>
          ) : activeRows.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
              {tab === "applications" ? (
                <>
                  No applications yet. Share the application form link above and they will appear
                  here as Waiting.{" "}
                  <a href="#application-form" className="font-medium text-accent hover:underline">
                    Go to the form
                  </a>
                </>
              ) : (
                <>
                  No candidates have reached the interview stage yet. Schedule an interview from an
                  application and it will appear here.
                </>
              )}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
              No candidates match the current search or filters.{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setCutoffApplied(null);
                  setCutoff("");
                  setPage(1);
                }}
                className="font-medium text-accent hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : tab === "applications" ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <SortableHeader label="Candidate" column="candidate" sort={sort} onSort={toggleSort} className="w-[38%]" />
                    <SortableHeader label="Applied" column="applied" sort={sort} onSort={toggleSort} />
                    <th scope="col" className="px-3 py-2">Stage</th>
                    <th scope="col" className="px-3 py-2">Decision</th>
                    <th scope="col" className="px-3 py-2 text-right"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ candidate, stage }) => {
                    const expanded = openApplication === candidate.applicationId;
                    return (
                      <Fragment key={candidate.candidateId}>
                        <tr className="rounded-lg bg-surface [&>td]:first:rounded-l-lg [&>td]:last:rounded-r-lg">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                                {initials(candidate.candidateName ?? candidate.candidateEmail)}
                              </span>
                              <span>
                                <span className="font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                                <span className="block text-xs text-muted">{candidate.candidateEmail}</span>
                                {candidate.candidatePhone && (
                                  <span className="block text-xs text-muted">{candidate.candidatePhone}</span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted">
                            {candidate.appliedAt ? formatDate(candidate.appliedAt) : formatDate(candidate.latestInterviewAt)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HIRE_STAGE_STYLES[stage]}`}>
                              {HIRE_STAGE_LABELS[stage]}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            {candidate.applicationStatus === "rejected" ? "Rejected" : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setOpenApplication(expanded ? null : candidate.applicationId ?? null)}
                              aria-expanded={expanded}
                              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                            >
                              {expanded ? "Close" : "Review application"}
                            </button>
                          </td>
                        </tr>
                        {expanded && candidate.applicationId && (
                          <tr id={`application-${candidate.applicationId}`}>
                            <td colSpan={5} className="rounded-lg bg-background px-4 py-4">
                              <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted">Applicant details</p>
                                  <dl className="mt-2 space-y-1 text-sm">
                                    <div className="flex gap-2">
                                      <dt className="w-28 shrink-0 text-muted">Phone</dt>
                                      <dd>{candidate.candidatePhone ?? "—"}</dd>
                                    </div>
                                    <div className="flex gap-2">
                                      <dt className="w-28 shrink-0 text-muted">College roll no.</dt>
                                      <dd>{candidate.candidateCollegeId ?? "—"}</dd>
                                    </div>
                                    <div className="flex gap-2">
                                      <dt className="w-28 shrink-0 text-muted">Applied</dt>
                                      <dd>{candidate.appliedAt ? formatDate(candidate.appliedAt) : "—"}</dd>
                                    </div>
                                    {Object.entries(candidate.answers ?? {}).map(([fieldId, value]) => (
                                      <div key={fieldId} className="flex gap-2">
                                        <dt className="w-28 shrink-0 text-muted">
                                          {formFields.find((field) => field.id === fieldId)?.label ?? fieldId}
                                        </dt>
                                        <dd className="whitespace-pre-line">{value || "—"}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </div>
                                <div className="flex flex-col gap-2 sm:items-end">
                                  <a
                                    href={`/api/roles/${roleId}/applications/${encodeURIComponent(candidate.applicationId)}/resume`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-accent transition hover:border-accent/50"
                                  >
                                    Open resume
                                  </a>
                                  <Link
                                    href={`/recruiter?roleId=${encodeURIComponent(roleId)}&candidateName=${encodeURIComponent(candidate.candidateName ?? "")}&candidateEmail=${encodeURIComponent(candidate.candidateEmail)}`}
                                    className="rounded-md bg-accent px-3 py-1.5 text-center text-sm font-medium text-white transition hover:bg-accent/90"
                                  >
                                    Schedule interview
                                  </Link>
                                  {candidate.applicationStatus === "rejected" ? (
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() => setApplicationStage(candidate.applicationId!, "restore")}
                                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50 disabled:opacity-60"
                                    >
                                      Move back to Waiting
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() => setApplicationStage(candidate.applicationId!, "reject")}
                                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
                                    >
                                      Reject application
                                    </button>
                                  )}
                                  <p className="text-xs text-muted sm:text-right">
                                    Reject when the resume does not match the role&apos;s requirements.
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[880px] border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all candidates on this page"
                        checked={allSelected}
                        onChange={() => {
                          setSelected(
                            allSelected
                              ? new Set()
                              : new Set(pageRows.map((row) => row.candidate.candidateId)),
                          );
                        }}
                      />
                    </th>
                    <SortableHeader label="Candidate" column="candidate" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Interview date" column="interview" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Status" column="status" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Score" column="score" sort={sort} onSort={toggleSort} />
                    <th scope="col" className="px-3 py-2">Evaluation</th>
                    <th scope="col" className="px-3 py-2">Decision</th>
                    <th scope="col" className="px-3 py-2 text-right"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ candidate }) => {
                    const status = candidate.latestStatus;
                    return (
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
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                              {initials(candidate.candidateName ?? candidate.candidateEmail)}
                            </span>
                            <span>
                              <span className="font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                              <span className="block text-xs text-muted">{candidate.candidateEmail}</span>
                              {candidate.appliedAt && (
                                <span className="block text-xs text-muted">Applied {formatDate(candidate.appliedAt)}</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted">
                          {formatDateTime(candidate.scheduledAt ?? candidate.latestInterviewAt)}
                          {candidate.completedAt && status === "completed" && (
                            <span className="block">Ended {formatDate(candidate.completedAt)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INTERVIEW_STATUS_STYLES[status]}`}>
                            {INTERVIEW_STATUS_LABELS[status]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {candidate.overallScore === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${scoreBadgeClass(candidate.overallScore)}`}>
                              {candidate.overallScore}/100
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {candidate.suggestion ? (
                            SUGGESTION_LABELS[candidate.suggestion]
                          ) : (
                            <span className="text-muted">Not scored</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {candidate.decision ? (
                            DECISION_LABELS[candidate.decision.outcome]
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link
                            href={`/dashboard/${candidate.latestInterviewId}`}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            View report
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {visibleRows.length > PAGE_SIZE && (
            <Pagination
              page={currentPage}
              pageSize={PAGE_SIZE}
              total={visibleRows.length}
              onPage={setPage}
            />
          )}
        </div>
      </div>
    </div>
  );
}

