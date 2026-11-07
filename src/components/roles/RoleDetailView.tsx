"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronRight,
  Download,
  FileText,
  Users,
  MoreHorizontal,
  Pencil,
  ExternalLink,
  Search,
  SearchX,
  UserPlus,
  X,
} from "lucide-react";
import type { HumanDecision } from "@/lib/interviews/interview.types";
import type {
  RoleCandidateSummary,
  RoleCandidatesResponse,
  RoleResponse,
  RoleSummary,
} from "@/lib/roles/role.types";
import { compareByHirePriority, deriveApplicationStage, deriveHireStage, type HireStage } from "@/lib/roles/hire-stage";
import { compareCandidateRows, type CandidateSortKey, type SortState } from "@/lib/roles/candidate-sort";
import { countPipeline, PIPELINE_STEPS, pipelineStep, scoreTone, type PipelineStep } from "@/lib/roles/pipeline";
import type { ApplicationField } from "@/lib/roles/application.types";
import { documentFacts } from "@/lib/text/document-blocks";
import { ApplicationFormSettings } from "@/components/roles/ApplicationFormSettings";
import { RoleFormSheet } from "@/components/roles/RoleFormSheet";
import { RoleIcon } from "@/components/roles/RoleIcon";
import { Pagination } from "@/components/dashboard/Pagination";
import { Menu } from "@/components/dashboard/menu";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { FilterMenu } from "@/components/dashboard/Toolbar";
import { Avatar, StatusBadge } from "@/components/dashboard/primitives";
import { DocumentText } from "@/components/ui/DocumentText";
import { Sheet } from "@/components/ui/Sheet";
import { EASE_OUT } from "@/components/ui/animated";
import { Toast, type ToastMessage } from "@/components/ui/Toast";

/**
 * One role as a hiring workspace: the application form bar, then everyone
 * in the pipeline as one paginated list. Stage tiles filter the list, and
 * search, status, score and sorting narrow it further, so it stays usable
 * with hundreds of candidates. The job description has its own tab.
 * Every number and stage comes from the roles API.
 */

const SUGGESTION_LABELS: Record<string, string> = {
  strong: "Strong",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Not enough to judge",
};

const DECISION_LABELS: Record<HumanDecision["outcome"], string> = {
  advance: "Advanced",
  hold: "On hold",
  reject: "Rejected",
};

const DECISION_TEXT: Record<HumanDecision["outcome"], string> = {
  advance: "text-emerald-600 dark:text-emerald-400",
  hold: "text-amber-600 dark:text-amber-400",
  reject: "text-rose-600 dark:text-rose-400",
};

/** Facts lifted into the header, in this order. */
const HEADER_FACTS = ["location", "employment type", "experience", "job type", "work mode"];

const PAGE_SIZE = 25;

type StageTab = "candidates" | "description";
type StageFilter = PipelineStep | "all";
type StatusFilter = "all" | "scheduled" | "in-progress" | "completed" | "cancelled";

const STATUS_FILTERS = [
  { value: "all", label: "Any status" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in-progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Expired or cancelled" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDay(iso: string): { day: string; time: string } {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

interface LeaderRow {
  candidate: RoleCandidateSummary;
  stage: HireStage;
}

const ghostButton =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50";

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: CandidateSortKey;
  sort: SortState | null;
  onSort: (column: CandidateSortKey) => void;
  className?: string;
}) {
  const active = sort?.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2.5 font-medium ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 transition hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? (
          sort!.direction === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}

/** Animated tab underline, matching the report's section bar. */
function StageTabs({
  value,
  onChange,
  total,
}: {
  value: StageTab;
  onChange: (tab: StageTab) => void;
  total: number;
}) {
  const tabs: { id: StageTab; label: string; count?: number; icon: ReactNode }[] = [
    { id: "candidates", label: "Candidates", count: total, icon: <Users className="size-4" aria-hidden /> },
    { id: "description", label: "Job description", icon: <FileText className="size-4" aria-hidden /> },
  ];
  return (
    <div role="tablist" aria-label="Role views" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`relative -mb-px flex shrink-0 items-center gap-2 px-3 pb-3 pt-1 text-sm font-medium transition-colors ${
              active ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            <span className={active ? "text-accent" : ""}>{tab.icon}</span>
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-md px-1.5 text-xs tabular-nums ${active ? "bg-accent-soft text-accent" : "bg-foreground/[0.06]"}`}
              >
                {tab.count}
              </span>
            )}
            {active && (
              <motion.span
                layoutId="role-stage-underline"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One tile per stage. Each tile filters the list below to that stage. */
function StageStrip({
  counts,
  total,
  value,
  onChange,
}: {
  counts: Record<PipelineStep, number> | null;
  total: number;
  value: StageFilter;
  onChange: (stage: StageFilter) => void;
}) {
  const reduce = useReducedMotion();
  const tiles: { id: StageFilter; label: string; count: number; tile: string; bar: string }[] = [
    { id: "all", label: "Everyone", count: total, tile: "bg-foreground/[0.04] text-foreground", bar: "bg-foreground/40" },
    ...PIPELINE_STEPS.map(({ step, label, tile, bar }) => ({
      id: step as StageFilter,
      label: step === "closed" ? "Rejected" : label,
      count: counts?.[step] ?? 0,
      tile,
      bar,
    })),
  ];
  return (
    <div role="group" aria-label="Filter by stage" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {tiles.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active && item.id !== "all" ? "all" : item.id)}
            className={`relative overflow-hidden rounded-xl px-3.5 py-3 text-left transition ${
              item.count > 0 || item.id === "all" ? item.tile : "bg-foreground/[0.03] text-muted"
            } ${active ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : "hover:brightness-[0.97]"}`}
          >
            <span className="block text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
              {counts === null ? "–" : item.count}
            </span>
            <span className="mt-1.5 block truncate text-xs font-medium">{item.label}</span>
            {item.id !== "all" && total > 0 && item.count > 0 && (
              <span className="absolute inset-x-3.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-current/10">
                <motion.span
                  className={`block h-full rounded-full ${item.bar}`}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(item.count / total) * 100}%` }}
                  transition={{ duration: 0.7, delay: 0.15, ease: EASE_OUT }}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The date a row is shown and sorted by: when they applied or were interviewed. */
function rowDate(candidate: RoleCandidateSummary): string {
  return candidate.interviews === 0
    ? candidate.appliedAt ?? candidate.latestInterviewAt
    : candidate.completedAt ?? candidate.scheduledAt ?? candidate.latestInterviewAt;
}

export function RoleDetailView({ roleId }: { roleId: string }) {
  const [role, setRole] = useState<RoleSummary | null>(null);
  const [candidates, setCandidates] = useState<RoleCandidateSummary[] | null>(null);
  const [, setCounts] = useState<{ applied: number; interview: number }>({ applied: 0, interview: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDecision, setConfirmingDecision] = useState<HumanDecision["outcome"] | null>(null);
  const [formFields, setFormFields] = useState<ApplicationField[]>([]);
  const [openApplication, setOpenApplication] = useState<string | null>(null);

  const router = useRouter();
  const [tab, setTab] = useState<StageTab>("candidates");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const dismissToast = useCallback(() => setToast(null), []);

  const fail = (cause: unknown, fallback: string) =>
    setToast({ tone: "error", message: cause instanceof Error ? cause.message : fallback });

  function loadRole() {
    fetch(`/api/roles/${roleId}`)
      .then(async (response) => {
        const body = (await response.json()) as RoleResponse & { error?: { message?: string } };
        if (!response.ok || !body.role) throw new Error(body.error?.message ?? "Could not load this role.");
        setRole(body.role);
        setLoadError(null);
      })
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : "Could not load this role."));
  }

  /**
   * Loads every candidate row for the role, page by page, so search, sorting
   * and pagination act on the whole list rather than one server page.
   */
  async function loadCandidates() {
    const collected: RoleCandidateSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let latestCounts: { applied: number; interview: number } | null = null;
    try {
      while (offset < total && offset < 2_000) {
        const response = await fetch(`/api/roles/${roleId}/candidates?limit=50&offset=${offset}`);
        const body = (await response.json()) as RoleCandidatesResponse & { error?: { message?: string } };
        if (!response.ok || !body.candidates) throw new Error(body.error?.message ?? "Could not load the candidates.");
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
      // Deep link from elsewhere: /dashboard/roles/<id>#application-<applicationId>
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash.startsWith("#application-") && hash !== "#application-form") {
        setOpenApplication(decodeURIComponent(hash.slice("#application-".length)));
      }
    } catch (cause) {
      fail(cause, "Could not load the candidates.");
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
      .then(async (response) => (response.ok ? ((await response.json()) as { fields?: ApplicationField[] }) : null))
      .then((body) => setFormFields(body?.fields ?? []))
      .catch(() => setFormFields([]));
  }, [roleId]);

  async function setApplicationStage(applicationId: string, action: "reject" | "restore") {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/roles/${roleId}/applications/${encodeURIComponent(applicationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update the application.");
      setToast({ tone: "success", message: action === "reject" ? "Application rejected." : "Application moved back to waiting." });
      setOpenApplication(null);
      loadCandidates();
    } catch (cause) {
      fail(cause, "Could not update the application.");
    } finally {
      setActionBusy(false);
    }
  }

  /** Ranked rows: recruiter decisions first, then ready to advance, then by score. */
  const rows = useMemo<LeaderRow[] | null>(() => {
    if (candidates === null) return null;
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
                cutoff: null,
              }),
      }))
      .sort((a, b) =>
        compareByHirePriority(
          { stage: a.stage, overallScore: a.candidate.overallScore },
          { stage: b.stage, overallScore: b.candidate.overallScore },
        ),
      );
    return ranked;
  }, [candidates]);

  const stageCounts = useMemo(
    () =>
      rows ? countPipeline(rows.map((row) => ({ stage: row.stage, interviewed: row.candidate.interviews > 0 }))) : null,
    [rows],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (rows ?? []).filter((row) => {
      const candidate = row.candidate;
      if (stageFilter !== "all" && pipelineStep(row.stage, candidate.interviews > 0) !== stageFilter) return false;
      if (needle) {
        const haystack = [
          candidate.candidateName ?? "",
          candidate.candidateEmail,
          candidate.candidatePhone ?? "",
          candidate.candidateCollegeId ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (statusFilter !== "all") {
        if (candidate.interviews === 0) return false;
        const status = candidate.latestStatus;
        if (statusFilter === "scheduled" && status !== "scheduled") return false;
        if (statusFilter === "in-progress" && status !== "waiting" && status !== "active") return false;
        if (statusFilter === "completed" && status !== "completed") return false;
        if (statusFilter === "cancelled" && status !== "cancelled" && status !== "expired") return false;
      }
      return true;
    });
    if (sort === null) return filtered;
    return [...filtered].sort((a, b) => {
      if (sort.key === "applied") {
        const result = Date.parse(rowDate(a.candidate)) - Date.parse(rowDate(b.candidate));
        return sort.direction === "asc" ? result : -result;
      }
      return compareCandidateRows(a, b, sort);
    });
  }, [rows, query, stageFilter, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function selectTab(next: StageTab) {
    setTab(next);
    setPage(1);
    setSelected(new Set());
  }

  function selectStage(next: StageFilter) {
    setStageFilter(next);
    setPage(1);
    setSelected(new Set());
  }

  function toggleSort(key: CandidateSortKey) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "candidate" ? "asc" : "desc" },
    );
    setPage(1);
  }

  function clearFilters() {
    setStageFilter("all");
    setQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  async function setRoleStatus(status: "open" | "completed") {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not update the role.");
      }
      setConfirmingClose(false);
      setToast({ tone: "success", message: status === "completed" ? "Role marked as completed." : "Role reopened." });
      loadRole();
    } catch (cause) {
      fail(cause, "Could not update the role.");
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
      setToast(
        failCount === 0
          ? { tone: "success", message: `${okCount} candidate${okCount === 1 ? "" : "s"} marked ${DECISION_LABELS[outcome].toLowerCase()}.` }
          : { tone: "error", message: `${okCount} saved, ${failCount} failed: ${body.failed?.[0]?.error ?? ""}` },
      );
      setSelected(new Set());
      setConfirmingDecision(null);
      loadCandidates();
    } catch (cause) {
      fail(cause, "Could not record the decisions.");
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

  const selectableRows = pageRows.filter((row) => row.candidate.interviews > 0);
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.candidate.candidateId));

  function exportCsv() {
    const link = document.createElement("a");
    link.href = `/api/roles/${roleId}/candidates/export`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (loadError && role === null) {
    return (
      <div className="py-16 text-center">
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {loadError}
        </p>
        <Link href="/dashboard/roles" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to roles
        </Link>
      </div>
    );
  }

  if (role === null) {
    return (
      <div aria-hidden className="space-y-6 pt-10">
        <div className="skeleton h-8 w-72 rounded-lg" />
        <div className="skeleton h-20 rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="skeleton h-80 rounded-2xl" />
          <div className="skeleton h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  const facts = documentFacts(role.description);
  const headerFacts = HEADER_FACTS.map((label) => facts.find((fact) => fact.label.toLowerCase() === label)).filter(
    (fact): fact is { label: string; value: string } => Boolean(fact),
  );
  const inviteHref = `/recruiter?roleId=${encodeURIComponent(role.id)}`;
  const application = openApplication
    ? (candidates ?? []).find((candidate) => candidate.applicationId === openApplication) ?? null
    : null;

  return (
    <div className="pb-24">
      {/* ------------------------------------------------------------ header */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 pt-8 text-sm text-muted">
        <Link href="/dashboard/roles" className="transition hover:text-foreground">
          Roles
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="truncate text-foreground/80">{role.title}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 pb-6">
        <div className="flex min-w-0 items-center gap-4">
        <RoleIcon title={role.title} className="size-14" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{role.title}</h1>
            {role.status === "open" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                Open
              </span>
            ) : (
              <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1 text-xs font-medium text-muted">Completed</span>
            )}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {headerFacts.map((fact) => (
              <span key={fact.label}>{fact.value}</span>
            ))}
            {role.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-3.5" aria-hidden />
                Closes {formatDate(role.deadline)}
              </span>
            )}
            {role.stats.avgOverallScore !== null && (
              <span className="inline-flex items-center gap-1.5">
                Average score
                <span className={`font-semibold tabular-nums ${scoreTone(role.stats.avgOverallScore).text}`}>
                  {role.stats.avgOverallScore}
                </span>
              </span>
            )}
            <span>Created {formatDate(role.createdAt)}</span>
          </p>
        </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className={ghostButton}>
            <Pencil className="size-3.5 text-muted" aria-hidden />
            Edit
          </button>
          <Link
            href={inviteHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
          >
            <UserPlus className="size-4" aria-hidden />
            Invite a candidate
          </Link>
          <Menu
            label="Role actions"
            align="end"
            trigger={
              <button
                type="button"
                aria-label="More role actions"
                className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-foreground/20 hover:text-foreground"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            }
            items={[
              { id: "export", label: "Download candidates (CSV)", icon: <Download className="size-4" aria-hidden />, onSelect: exportCsv },
              role.status === "open"
                ? { id: "complete", label: "Mark role as completed", onSelect: () => setConfirmingClose(true) }
                : { id: "reopen", label: "Reopen role", onSelect: () => setRoleStatus("open") },
            ]}
          />
        </div>
      </header>

      {/* ------------------------------------------------- application form */}
      <ApplicationFormSettings roleId={roleId} roleTitle={role.title} roleDescription={role.description} />

      {/* ------------------------------------------------------------ views */}
      <section className="mt-8" aria-label="Candidates">
        <StageTabs value={tab} onChange={selectTab} total={rows?.length ?? 0} />

        {tab === "description" && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            <article className="rounded-2xl border border-border bg-surface px-6 py-6 sm:px-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">About the role</h2>
                <button type="button" onClick={() => setEditing(true)} className={ghostButton}>
                  <Pencil className="size-3.5 text-muted" aria-hidden />
                  Edit
                </button>
              </div>
              {role.description.trim() ? (
                <DocumentText
                  text={role.description}
                  hideFactLabels={headerFacts.map((fact) => fact.label)}
                  className="mt-5"
                />
              ) : (
                <p className="mt-3 text-sm text-muted">
                  No description yet.{" "}
                  <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
                    Add one
                  </button>{" "}
                  so interviews can be planned and scored against it.
                </p>
              )}
            </article>
            <aside className="rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-20">
              <h3 className="text-sm font-semibold">Skills the interview tests</h3>
              {role.skills.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {role.skills.map((skill) => (
                    <span key={skill} className="rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">None listed yet.</p>
              )}
              {headerFacts.length > 0 && (
                <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
                  {headerFacts.map((fact) => (
                    <div key={fact.label} className="flex justify-between gap-3">
                      <dt className="text-muted">{fact.label}</dt>
                      <dd className="text-right font-medium">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </aside>
          </div>
        )}

        {tab === "candidates" && (
          <div className="mt-5">
            <StageStrip counts={stageCounts} total={rows?.length ?? 0} value={stageFilter} onChange={selectStage} />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Name, email, phone or roll no."
                  aria-label="Search candidates"
                  className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
              <FilterMenu
                label="Interview status"
                icon={<span aria-hidden className="block size-2 rounded-full bg-current" />}
                value={statusFilter}
                options={STATUS_FILTERS}
                onChange={(value) => {
                  setStatusFilter(value as StatusFilter);
                  setPage(1);
                }}
              />
              {(query !== "" || statusFilter !== "all" || stageFilter !== "all") && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                  Reset
                </button>
              )}
              <span className="grow" />
              <span className="text-sm tabular-nums text-muted">
                {visibleRows.length} {visibleRows.length === 1 ? "person" : "people"}
                {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
              </span>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
              {candidates === null ? (
                <div aria-hidden className="divide-y divide-border">
                  {[0, 1, 2, 3].map((key) => (
                    <div key={key} className="flex items-center gap-3 px-5 py-4">
                      <div className="skeleton size-8 rounded-full" />
                      <div className="skeleton h-4 w-48 rounded" />
                    </div>
                  ))}
                </div>
              ) : (rows ?? []).length === 0 ? (
                <div className="grid place-items-center px-6 py-14 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                    <Users className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-medium">No candidates yet</p>
                  <p className="mt-1 max-w-sm text-sm text-muted">
                    Copy the application form link above and share it, or invite someone straight to an interview.
                  </p>
                  <Link href={inviteHref} className="mt-4 text-sm font-medium text-accent hover:underline">
                    Invite a candidate
                  </Link>
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="grid place-items-center px-6 py-14 text-center">
                  <span className="grid size-11 place-items-center rounded-full bg-foreground/[0.05] text-muted">
                    <SearchX className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-medium">Nobody matches these filters</p>
                  <button type="button" onClick={clearFilters} className="mt-3 text-sm font-medium text-accent hover:underline">
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-foreground/[0.015] text-xs text-muted">
                        <th scope="col" className="w-10 py-2.5 pl-5">
                          <input
                            type="checkbox"
                            aria-label="Select every interviewed candidate on this page"
                            checked={allSelected}
                            disabled={selectableRows.length === 0}
                            onChange={() =>
                              setSelected(
                                allSelected ? new Set() : new Set(selectableRows.map((row) => row.candidate.candidateId)),
                              )
                            }
                            className="size-4 cursor-pointer accent-[var(--accent)] disabled:opacity-30"
                          />
                        </th>
                        <SortableHeader label="Candidate" column="candidate" sort={sort} onSort={toggleSort} />
                        <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
                        <SortableHeader label="Score" column="score" sort={sort} onSort={toggleSort} />
                        <SortableHeader label="Date" column="applied" sort={sort} onSort={toggleSort} />
                        <th scope="col" className="px-3 py-2.5 font-medium">Outcome</th>
                        <th scope="col" className="w-10 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map(({ candidate, stage }) => {
                        const interviewed = candidate.interviews > 0;
                        const isSelected = selected.has(candidate.candidateId);
                        const step = PIPELINE_STEPS.find((item) => item.step === pipelineStep(stage, interviewed))!;
                        const when = formatDay(rowDate(candidate));
                        const score = candidate.overallScore;
                        const open = () =>
                          interviewed
                            ? router.push(`/dashboard/${candidate.latestInterviewId}`)
                            : setOpenApplication(candidate.applicationId ?? null);
                        return (
                          <tr
                            key={candidate.candidateId}
                            onClick={(event) => {
                              if ((event.target as HTMLElement).closest("a,button,input")) return;
                              open();
                            }}
                            className={`cursor-pointer transition-colors ${isSelected ? "bg-accent-soft/60" : "hover:bg-foreground/[0.02]"}`}
                          >
                            <td className="py-3 pl-5">
                              {interviewed && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${candidate.candidateName ?? candidate.candidateEmail}`}
                                  checked={isSelected}
                                  onChange={() => toggle(candidate.candidateId)}
                                  className="size-4 cursor-pointer accent-[var(--accent)]"
                                />
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar name={candidate.candidateName ?? candidate.candidateEmail} className="size-8 text-xs" />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                                  <span className="block truncate text-xs text-muted">{candidate.candidateEmail}</span>
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${step.tile}`}>
                                <span aria-hidden className={`size-1.5 rounded-full ${step.dot}`} />
                                {step.step === "closed" ? "Rejected" : step.label}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              {score === null ? (
                                <span className="text-muted">—</span>
                              ) : (
                                <div className="flex items-center gap-2.5">
                                  <span className={`w-7 text-[15px] font-semibold tabular-nums ${scoreTone(score).text}`}>{score}</span>
                                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/[0.07]">
                                    <span className={`block h-full rounded-full ${scoreTone(score).bar}`} style={{ width: `${score}%` }} />
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 tabular-nums">
                              {when.day}
                              <span className="block text-xs text-muted">{interviewed ? "Interview" : "Applied"}</span>
                            </td>
                            <td className="px-3 py-3">
                              {candidate.decision ? (
                                <span className={`font-medium ${DECISION_TEXT[candidate.decision.outcome]}`}>
                                  {DECISION_LABELS[candidate.decision.outcome]}
                                </span>
                              ) : interviewed ? (
                                candidate.latestStatus === "completed" ? (
                                  <span className="text-muted">
                                    {candidate.suggestion ? SUGGESTION_LABELS[candidate.suggestion] : "Not decided"}
                                  </span>
                                ) : (
                                  <StatusBadge status={candidate.latestStatus} />
                                )
                              ) : candidate.applicationStatus === "rejected" ? (
                                <span className="font-medium text-rose-600 dark:text-rose-400">Rejected</span>
                              ) : (
                                <span className="text-muted">Waiting for review</span>
                              )}
                            </td>
                            <td className="px-3 py-3 pr-5 text-right">
                              <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {visibleRows.length > PAGE_SIZE && (
              <Pagination page={currentPage} pageSize={PAGE_SIZE} total={visibleRows.length} onPage={setPage} />
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ application review */}
      <Sheet
        open={application !== null}
        onClose={() => setOpenApplication(null)}
        title={application?.candidateName ?? "Application"}
        description={application ? `Applied ${formatDate(application.appliedAt ?? application.latestInterviewAt)}` : undefined}
        footer={
          application?.applicationId ? (
            <>
              {application.applicationStatus === "rejected" ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setApplicationStage(application.applicationId!, "restore")}
                  className={ghostButton}
                >
                  Move back to waiting
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setApplicationStage(application.applicationId!, "reject")}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
                >
                  Reject
                </button>
              )}
              <span className="grow" />
              <Link
                href={`/recruiter?roleId=${encodeURIComponent(roleId)}&candidateName=${encodeURIComponent(
                  application.candidateName ?? "",
                )}&candidateEmail=${encodeURIComponent(application.candidateEmail)}`}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
              >
                Schedule an interview
              </Link>
            </>
          ) : undefined
        }
      >
        {application && (
          <div className="grid gap-6">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted">Email</dt>
              <dd className="break-all font-medium">{application.candidateEmail}</dd>
              <dt className="text-muted">Phone</dt>
              <dd className="font-medium tabular-nums">{application.candidatePhone ?? "—"}</dd>
              <dt className="text-muted">College roll no.</dt>
              <dd className="font-medium">{application.candidateCollegeId ?? "—"}</dd>
              <dt className="text-muted">Status</dt>
              <dd className="font-medium">{application.applicationStatus === "rejected" ? "Rejected" : "Waiting for review"}</dd>
            </dl>

            {Object.keys(application.answers ?? {}).length > 0 && (
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Answers</h3>
                <dl className="mt-4 grid gap-4">
                  {Object.entries(application.answers ?? {}).map(([fieldId, value]) => (
                    <div key={fieldId}>
                      <dt className="text-sm text-muted">{formFields.find((field) => field.id === fieldId)?.label ?? fieldId}</dt>
                      <dd className="mt-1 whitespace-pre-line text-[15px] leading-6">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {application.applicationId && (
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Resume</h3>
                <a
                  href={`/api/roles/${roleId}/applications/${encodeURIComponent(application.applicationId)}/resume`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center gap-3 rounded-xl border border-border p-3 transition hover:border-foreground/20 hover:bg-foreground/[0.02]"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-foreground/[0.05] text-muted">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Open the resume</span>
                    <span className="block text-xs text-muted">Opens in a new tab</span>
                  </span>
                  <ExternalLink className="size-3.5 text-muted" aria-hidden />
                </a>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------------- bulk decide */}
      <AnimatePresence>
        {selected.size > 0 && tab === "candidates" && (
          <motion.div
            role="toolbar"
            aria-label="Decide for the selected candidates"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-1 rounded-2xl border border-border bg-surface/95 p-1.5 pl-4 shadow-2xl shadow-black/15 backdrop-blur-xl dark:shadow-black/50"
          >
            <p className="pr-3 text-sm font-medium tabular-nums">{selected.size} selected</p>
            <button
              type="button"
              onClick={() => setConfirmingDecision("advance")}
              className="h-8 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Advance
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDecision("hold")}
              className="h-8 rounded-lg px-3 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
            >
              Hold
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDecision("reject")}
              className="h-8 rounded-lg px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
            >
              Reject
            </button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="h-8 rounded-lg px-3 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmingDecision !== null}
        title={`${confirmingDecision === "advance" ? "Advance" : confirmingDecision === "hold" ? "Put on hold" : "Reject"} ${
          selected.size
        } candidate${selected.size === 1 ? "" : "s"}?`}
        body="The decision is saved on each person's latest interview. You can change it later from their report."
        confirmLabel="Confirm"
        busyLabel="Saving…"
        tone={confirmingDecision === "reject" ? "danger" : "default"}
        busy={actionBusy}
        onConfirm={() => confirmingDecision && applyDecision(confirmingDecision)}
        onCancel={() => setConfirmingDecision(null)}
      />

      <ConfirmDialog
        open={confirmingClose}
        title="Mark this role as completed?"
        body="It stays readable and downloadable, and you can reopen it at any time."
        confirmLabel="Mark completed"
        busyLabel="Saving…"
        tone="default"
        busy={actionBusy}
        onConfirm={() => setRoleStatus("completed")}
        onCancel={() => setConfirmingClose(false)}
      />

      <RoleFormSheet
        open={editing}
        role={role}
        onClose={() => setEditing(false)}
        onSaved={(message) => {
          setEditing(false);
          setToast({ tone: "success", message });
          loadRole();
        }}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
