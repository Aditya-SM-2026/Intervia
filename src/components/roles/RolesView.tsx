"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpDown, Briefcase, Layers, MoreHorizontal, Plus, Search, SearchX, Trash2, UserPlus, X } from "lucide-react";
import type {
  RoleCandidateSummary,
  RoleCandidatesResponse,
  RoleStatus,
  RoleSummary,
  RolesResponse,
} from "@/lib/roles/role.types";
import { deriveApplicationStage, deriveHireStage, type HireStage } from "@/lib/roles/hire-stage";
import { countPipeline, PIPELINE_STEPS, scoreTone, type PipelineStep } from "@/lib/roles/pipeline";
import { documentExcerpt } from "@/lib/text/document-blocks";
import { Menu } from "@/components/dashboard/menu";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { FilterMenu } from "@/components/dashboard/Toolbar";
import { EASE_OUT, SegmentedTabs } from "@/components/ui/animated";
import { Toast, type ToastMessage } from "@/components/ui/Toast";
import { RoleFormSheet } from "./RoleFormSheet";

/**
 * Roles list. One row per role: what it is, where its candidates are in the
 * pipeline, and how they scored. The row opens the role; everything else
 * (invite, form link, edit, delete) sits in the row menu.
 * Data comes from GET /api/roles and GET /api/roles/[id]/candidates.
 */

const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "candidates", label: "Most candidates" },
  { value: "score", label: "Highest average score" },
];
type SortKey = "updated" | "candidates" | "score";

const STEP_FILTERS = [
  { value: "", label: "Any stage" },
  ...PIPELINE_STEPS.map(({ step, label }) => ({ value: step, label: `Has ${label.toLowerCase()}` })),
];

async function fetchRoles(): Promise<RoleSummary[]> {
  const response = await fetch("/api/roles");
  const data = (await response.json()) as RolesResponse & { error?: { message?: string } };
  if (!response.ok || !data.roles) throw new Error(data.error?.message ?? "Could not load the roles.");
  return data.roles;
}

async function fetchCandidates(roleId: string): Promise<RoleCandidateSummary[]> {
  const response = await fetch(`/api/roles/${roleId}/candidates?limit=50&offset=0`);
  const data = (await response.json()) as RoleCandidatesResponse & { error?: { message?: string } };
  if (!response.ok || !data.candidates) throw new Error(data.error?.message ?? "Could not load the candidates.");
  return data.candidates;
}

function candidateStage(candidate: RoleCandidateSummary): HireStage {
  return candidate.applicationStatus && candidate.interviews === 0
    ? deriveApplicationStage(candidate.applicationStatus)
    : deriveHireStage({
        status: candidate.latestStatus,
        overallScore: candidate.overallScore,
        decision: candidate.decision?.outcome ?? null,
        cutoff: null,
      });
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  return `Updated ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Stacked bar of where this role's candidates are. */
function PipelineBar({
  counts,
  total,
  index,
}: {
  counts: Record<PipelineStep, number> | null;
  total: number;
  index: number;
}) {
  const reduce = useReducedMotion();
  if (counts === null) return <div className="skeleton h-2 w-full rounded-full" />;
  if (total === 0) return <p className="text-xs text-muted">No candidates yet</p>;
  const summary = PIPELINE_STEPS.filter(({ step }) => counts[step] > 0)
    .map(({ step, label }) => `${counts[step]} ${label.toLowerCase()}`)
    .join(", ");
  return (
    <div className="min-w-0">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-foreground/[0.05]" role="img" aria-label={summary}>
        {PIPELINE_STEPS.map(({ step, bar, label }) =>
          counts[step] > 0 ? (
            <motion.span
              key={step}
              title={`${counts[step]} ${label.toLowerCase()}`}
              className={`h-full first:rounded-l-full last:rounded-r-full ${bar}`}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${(counts[step] / total) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.15 + index * 0.05, ease: EASE_OUT }}
            />
          ) : null,
        )}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted">{summary}</p>
    </div>
  );
}

function RoleRow({
  role,
  index,
  counts,
  total,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onToast,
}: {
  role: RoleSummary;
  index: number;
  counts: Record<PipelineStep, number> | null;
  total: number;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onToast: (toast: ToastMessage) => void;
}) {
  const router = useRouter();
  const href = `/dashboard/roles/${role.id}`;
  const inviteHref = `/recruiter?roleId=${encodeURIComponent(role.id)}`;
  const excerpt = role.description.trim() ? documentExcerpt(role.description, 150) : "";
  const score = role.stats.avgOverallScore;

  function copyInvite() {
    const url = `${window.location.origin}${inviteHref}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => onToast({ tone: "success", message: "Invite link copied. It opens a new interview for this role." }))
      .catch(() => onToast({ tone: "success", message: url }));
  }

  function copyFormLink() {
    void fetch(`/api/roles/${encodeURIComponent(role.id)}/form-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        const body = (await response.json()) as { url?: string; error?: { message?: string } };
        if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not create the form link.");
        try {
          await navigator.clipboard.writeText(body.url);
          onToast({ tone: "success", message: "Application form link copied." });
        } catch {
          onToast({ tone: "success", message: body.url });
        }
      })
      .catch((cause: unknown) =>
        onToast({ tone: "error", message: cause instanceof Error ? cause.message : "Could not create the form link." }),
      );
  }

  return (
    <li
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button,input,[role='menu']")) return;
        router.push(href);
      }}
      className={`group grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 transition-colors sm:px-5 md:grid-cols-[1.25rem_minmax(0,1.5fr)_minmax(0,1fr)_5rem_7rem] ${
        selected ? "bg-accent-soft/60" : "hover:bg-foreground/[0.02]"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Select ${role.title}`}
        className={`size-4 cursor-pointer accent-[var(--accent)] transition-opacity ${
          selected ? "opacity-100" : "opacity-40 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={href} className="truncate text-[15px] font-semibold tracking-[-0.01em] hover:text-accent">
            {role.title}
          </Link>
          {role.status === "completed" ? (
            <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-muted">
              Completed
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
              Open
            </span>
          )}
          <span className="hidden shrink-0 text-xs text-muted lg:inline">{relativeDay(role.updatedAt)}</span>
        </div>
        {excerpt ? (
          <p className="mt-1 line-clamp-1 text-sm text-muted">{excerpt}</p>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="mt-1 text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            Add a job description
          </button>
        )}
        {role.skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {role.skills.slice(0, 4).map((skill) => (
              <span key={skill} className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                {skill}
              </span>
            ))}
            {role.skills.length > 4 && (
              <span className="px-1 py-0.5 text-[11px] text-muted">+{role.skills.length - 4} more</span>
            )}
          </div>
        )}
      </div>

      <div className="col-span-3 col-start-2 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto">
        <PipelineBar counts={counts} total={total} index={index} />
      </div>

      <div className="hidden text-right md:block">
        {score === null ? (
          <span className="text-sm text-muted">—</span>
        ) : (
          <>
            <span className={`text-lg font-semibold tabular-nums ${scoreTone(score).text}`}>{score}</span>
            <span className="block text-[11px] text-muted">average</span>
          </>
        )}
      </div>

      <div className="col-start-3 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-start-auto">
        <Link
          href={inviteHref}
          title="Send an interview for this role"
          className="hidden h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] sm:inline-flex"
        >
          <UserPlus className="size-3.5 text-muted" aria-hidden />
          Invite
        </Link>
        <Menu
          label={`Actions for ${role.title}`}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${role.title}`}
              className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          }
          items={[
            { id: "open", label: "Open role", onSelect: () => router.push(href) },
            { id: "edit", label: "Edit role", onSelect: onEdit, separatorAfter: true },
            { id: "invite", label: "Copy interview invite link", onSelect: copyInvite },
            { id: "form", label: "Copy application form link", onSelect: copyFormLink, separatorAfter: true },
            {
              id: "delete",
              label: "Delete role",
              icon: <Trash2 className="size-4" aria-hidden />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        />
      </div>
    </li>
  );
}

export function RolesView() {
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RoleStatus | "">("");
  const [stepFilter, setStepFilter] = useState<PipelineStep | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const [candidatesByRole, setCandidatesByRole] = useState<Record<string, RoleCandidateSummary[] | null>>({});
  const [sheet, setSheet] = useState<{ role: RoleSummary | null } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dismissToast = useCallback(() => setToast(null), []);

  function load() {
    fetchRoles()
      .then((result) => {
        setRoles(result);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the roles."));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Every role's candidates, for the pipeline bars, stage filter and search.
  useEffect(() => {
    if (roles === null) return;
    let cancelled = false;
    void Promise.allSettled(roles.map((role) => fetchCandidates(role.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, RoleCandidateSummary[] | null> = {};
      results.forEach((result, index) => {
        next[roles[index].id] = result.status === "fulfilled" ? result.value : null;
      });
      setCandidatesByRole(next);
    });
    return () => {
      cancelled = true;
    };
  }, [roles]);

  const pipelineByRole = useMemo(() => {
    const map: Record<string, Record<PipelineStep, number> | null> = {};
    for (const role of roles ?? []) {
      const candidates = candidatesByRole[role.id];
      map[role.id] = candidates
        ? countPipeline(candidates.map((candidate) => ({ stage: candidateStage(candidate), interviewed: candidate.interviews > 0 })))
        : candidates === null
          ? countPipeline([])
          : null;
    }
    return map;
  }, [roles, candidatesByRole]);

  const statusCounts = useMemo(() => {
    const list = roles ?? [];
    return {
      all: list.length,
      open: list.filter((role) => role.status === "open").length,
      completed: list.filter((role) => role.status === "completed").length,
    };
  }, [roles]);

  const filtered = useMemo(() => {
    let list = roles ?? [];
    const term = search.toLowerCase();
    if (term) {
      list = list.filter(
        (role) =>
          role.title.toLowerCase().includes(term) ||
          role.description.toLowerCase().includes(term) ||
          role.skills.some((skill) => skill.toLowerCase().includes(term)) ||
          (candidatesByRole[role.id] ?? []).some(
            (candidate) =>
              (candidate.candidateName ?? "").toLowerCase().includes(term) ||
              candidate.candidateEmail.toLowerCase().includes(term),
          ),
      );
    }
    if (statusFilter) list = list.filter((role) => role.status === statusFilter);
    if (stepFilter) list = list.filter((role) => (pipelineByRole[role.id]?.[stepFilter] ?? 0) > 0);
    return [...list].sort((a, b) => {
      if (sortBy === "candidates") return b.stats.candidates - a.stats.candidates;
      if (sortBy === "score") return (b.stats.avgOverallScore ?? -1) - (a.stats.avgOverallScore ?? -1);
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }, [roles, search, statusFilter, stepFilter, sortBy, candidatesByRole, pipelineByRole]);

  const hasActiveFilters = search !== "" || statusFilter !== "" || stepFilter !== "";

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatusFilter("");
    setStepFilter("");
  }

  function toggleSelected(roleId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(roleId);
      else next.delete(roleId);
      return next;
    });
  }

  async function confirmDelete() {
    if (!deleteIds || deleteIds.length === 0 || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deleteIds }),
      });
      const body = (await response.json().catch(() => null)) as
        | { deleted?: number; interviews?: number; error?: { message?: string } }
        | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not delete the roles.");
      const count = body?.deleted ?? deleteIds.length;
      const interviews = body?.interviews ?? 0;
      const subject = count === 1 ? "Role deleted" : `${count} roles deleted`;
      setToast({
        tone: "success",
        message:
          interviews > 0 ? `${subject}, with ${interviews} interview${interviews === 1 ? "" : "s"}.` : `${subject}.`,
      });
      setDeleteIds(null);
      setSelectedIds(new Set());
      load();
    } catch (deleteError) {
      setToast({ tone: "error", message: deleteError instanceof Error ? deleteError.message : "Could not delete the roles." });
    } finally {
      setDeleting(false);
    }
  }

  const rolesToDelete = deleteIds ? (roles ?? []).filter((role) => deleteIds.includes(role.id)) : [];
  const interviewsToDelete = rolesToDelete.reduce((sum, role) => sum + role.stats.interviews, 0);
  const single = deleteIds?.length === 1;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-7 pt-9">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Roles</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            The jobs you are hiring for, and where each one&apos;s candidates are.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSheet({ role: null })}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
        >
          <Plus className="size-4" aria-hidden />
          New role
        </button>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs
          id="role-status"
          label="Filter by role status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "", label: "All", count: statusCounts.all },
            { value: "open", label: "Open", count: statusCounts.open },
            { value: "completed", label: "Completed", count: statusCounts.completed },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search roles, skills or candidates"
              aria-label="Search roles, skills or candidates"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15 sm:w-72"
            />
          </div>
          <FilterMenu
            label="Pipeline stage"
            icon={<Layers className="size-4" aria-hidden />}
            value={stepFilter}
            options={STEP_FILTERS}
            onChange={(value) => setStepFilter(value as PipelineStep | "")}
          />
          <FilterMenu
            label="Sort"
            icon={<ArrowUpDown className="size-4" aria-hidden />}
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={(value) => setSortBy(value as SortKey)}
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.03]">
        <div className="hidden grid-cols-[1.25rem_minmax(0,1.5fr)_minmax(0,1fr)_5rem_7rem] items-center gap-x-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted md:grid">
          <span />
          <span>Role</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            Candidates
            {PIPELINE_STEPS.slice(0, 4).map(({ step, label, dot }) => (
              <span key={step} className="inline-flex items-center gap-1 font-normal">
                <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </span>
          <span className="text-right">Score</span>
          <span />
        </div>

        {roles === null && !error ? (
          <ul aria-hidden className="divide-y divide-border">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6 px-5 py-5">
                <div className="space-y-2">
                  <div className="skeleton h-4 w-48 rounded" />
                  <div className="skeleton h-3 w-80 max-w-full rounded" />
                </div>
                <div className="skeleton h-2 rounded-full" />
              </li>
            ))}
          </ul>
        ) : roles !== null && roles.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-foreground/[0.05] text-muted">
              <Briefcase className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium">Add the first role you are hiring for</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Paste its job description. Every interview for the role is planned and scored against it.
            </p>
            <button
              type="button"
              onClick={() => setSheet({ role: null })}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition hover:bg-accent/90"
            >
              <Plus className="size-4" aria-hidden />
              New role
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-foreground/[0.05] text-muted">
              <SearchX className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium">No roles match these filters</p>
            <button type="button" onClick={clearFilters} className="mt-3 text-sm font-medium text-accent hover:underline">
              Reset filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((role, index) => (
              <RoleRow
                key={role.id}
                role={role}
                index={index}
                counts={pipelineByRole[role.id] ?? null}
                total={candidatesByRole[role.id]?.length ?? 0}
                selected={selectedIds.has(role.id)}
                onSelect={(selected) => toggleSelected(role.id, selected)}
                onEdit={() => setSheet({ role })}
                onDelete={() => setDeleteIds([role.id])}
                onToast={setToast}
              />
            ))}
          </ul>
        )}
      </section>

      <RoleFormSheet
        open={sheet !== null}
        role={sheet?.role ?? null}
        onClose={() => setSheet(null)}
        onSaved={(message) => {
          const creating = sheet?.role == null;
          setSheet(null);
          if (creating) clearFilters();
          setToast({ tone: "success", message });
          load();
        }}
      />

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            role="toolbar"
            aria-label="Bulk actions"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-1 rounded-2xl border border-border bg-surface/95 p-1.5 pl-4 shadow-2xl shadow-black/15 backdrop-blur-xl dark:shadow-black/50"
          >
            <p className="pr-3 text-sm font-medium tabular-nums">{selectedIds.size} selected</p>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 rounded-lg px-3 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setDeleteIds([...selectedIds])}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={toast} onDismiss={dismissToast} />

      <ConfirmDialog
        open={deleteIds !== null}
        title={single ? "Delete this role?" : `Delete ${deleteIds?.length ?? 0} roles?`}
        body={
          <p>
            {single ? `“${rolesToDelete[0]?.title ?? "This role"}” is removed.` : "The selected roles are removed."}{" "}
            {interviewsToDelete > 0
              ? `${interviewsToDelete} interview${interviewsToDelete === 1 ? "" : "s"} go with ${
                  single ? "it" : "them"
                }, including reports and recordings. This cannot be undone.`
              : "No interviews are affected."}
          </p>
        }
        confirmLabel={interviewsToDelete > 0 ? "Delete with interviews" : single ? "Delete role" : "Delete roles"}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setDeleteIds(null);
        }}
      />
    </>
  );
}
