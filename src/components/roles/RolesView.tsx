"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUpDown,
  Briefcase,
  Check,
  ClipboardList,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type {
  RoleCandidateSummary,
  RoleCandidatesResponse,
  RoleStatus,
  RoleSummary,
  RolesResponse,
} from "@/lib/roles/role.types";
import { deriveApplicationStage, deriveHireStage, type HireStage } from "@/lib/roles/hire-stage";
import { countPipeline, PIPELINE_STEPS, type PipelineStep } from "@/lib/roles/pipeline";
import { Avatar } from "@/components/dashboard/primitives";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Menu } from "@/components/dashboard/menu";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { FilterMenu } from "@/components/dashboard/Toolbar";
import { EASE_OUT, SegmentedTabs } from "@/components/ui/animated";
import { Toast, type ToastMessage } from "@/components/ui/Toast";
import { RoleFormSheet } from "./RoleFormSheet";
import { RoleIcon } from "./RoleIcon";

/**
 * Roles list as cards. Each card shows where the role's candidates are (one
 * counter per stage), their average score, and the two things a recruiter
 * does most: share the application form and invite someone.
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
  counts: Record<PipelineStep, number>;
  total: number;
  index: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
      {PIPELINE_STEPS.map(({ step, bar }) =>
        counts[step] > 0 ? (
          <motion.span
            key={step}
            className={`h-full ${bar}`}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${(counts[step] / Math.max(total, 1)) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.15 + index * 0.05, ease: EASE_OUT }}
          />
        ) : null,
      )}
    </div>
  );
}

function RoleCard({
  role,
  index,
  counts,
  candidates,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onToast,
}: {
  role: RoleSummary;
  index: number;
  counts: Record<PipelineStep, number> | null;
  candidates: RoleCandidateSummary[] | null | undefined;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onToast: (toast: ToastMessage) => void;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [formCopied, setFormCopied] = useState(false);
  const href = `/dashboard/roles/${role.id}`;
  const inviteHref = `/recruiter?roleId=${encodeURIComponent(role.id)}`;
  const score = role.stats.avgOverallScore;
  const total = candidates?.length ?? 0;
  const people = (candidates ?? []).slice(0, 4);

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
          setFormCopied(true);
          setTimeout(() => setFormCopied(false), 1800);
          onToast({ tone: "success", message: "Application form link copied. Share it with applicants." });
        } catch {
          onToast({ tone: "success", message: body.url });
        }
      })
      .catch((cause: unknown) =>
        onToast({ tone: "error", message: cause instanceof Error ? cause.message : "Could not create the form link." }),
      );
  }

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.04, ease: EASE_OUT }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button,input,[role='menu']")) return;
        router.push(href);
      }}
      className={`group relative flex cursor-pointer flex-col rounded-2xl border bg-surface p-5 shadow-sm shadow-black/[0.02] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.06] ${
        selected ? "border-accent ring-4 ring-accent/10" : "border-border hover:border-foreground/15"
      }`}
    >
      {/* title row */}
      <div className="flex items-start gap-3">
        <RoleIcon title={role.title} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={href} className="truncate text-[17px] font-semibold tracking-[-0.015em] hover:text-accent">
              {role.title}
            </Link>
            {role.status === "completed" ? (
              <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted">
                Completed
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                Open
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">{relativeDay(role.updatedAt)}</p>
        </div>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={`Select ${role.title}`}
          className={`mt-1 size-4 shrink-0 cursor-pointer accent-[var(--accent)] transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
          }`}
        />
        <Menu
          label={`Actions for ${role.title}`}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${role.title}`}
              className="-mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          }
          items={[
            { id: "edit", label: "Edit role", icon: <Pencil className="size-4" aria-hidden />, onSelect: onEdit, separatorAfter: true },
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

      {/* headline figures */}
      <div className="mt-5 flex items-center gap-4">
        <ScoreRing score={score} size={60} stroke={5} label={score === null ? undefined : "avg"} delay={0.1 + index * 0.04} />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{counts === null ? "…" : total}</span>
            <span className="text-sm text-muted">{total === 1 ? "candidate" : "candidates"}</span>
          </p>
          <div className="mt-2">
            {counts === null ? (
              <div className="skeleton h-1.5 w-full rounded-full" />
            ) : total === 0 ? (
              <p className="text-xs text-muted">No one yet</p>
            ) : (
              <>
                <PipelineBar counts={counts} total={total} index={index} />
                <p className="mt-1.5 truncate text-xs text-muted">
                  {PIPELINE_STEPS.filter(({ step }) => counts[step] > 0)
                    .map(({ step, label }) => `${counts[step]} ${step === "closed" ? "rejected" : label.toLowerCase()}`)
                    .join(", ")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* footer actions */}
      <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
        <div className="flex -space-x-2">
          {people.map((person) => (
            <Avatar
              key={person.candidateId}
              name={person.candidateName ?? person.candidateEmail}
              className="size-7 text-[11px] ring-2 ring-surface"
            />
          ))}
          {total > people.length && (
            <span className="grid size-7 place-items-center rounded-full bg-foreground/[0.06] text-[10px] font-semibold text-muted ring-2 ring-surface">
              +{total - people.length}
            </span>
          )}
        </div>
        <span className="grow" />
        <button
          type="button"
          onClick={copyFormLink}
          title="Copy the application form link"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]"
        >
          {formCopied ? (
            <Check className="size-3.5 text-emerald-600" aria-hidden />
          ) : (
            <ClipboardList className="size-3.5 text-muted" aria-hidden />
          )}
          {formCopied ? "Copied" : "Form link"}
        </button>
        <Link
          href={inviteHref}
          title="Send an interview for this role"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-xs font-medium text-background transition hover:bg-foreground/85"
        >
          <UserPlus className="size-3.5" aria-hidden />
          Invite
        </Link>
      </div>
    </motion.li>
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

      <section className="mt-5" aria-label="Roles">
        {roles === null && !error ? (
          <ul aria-hidden className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <li key={key} className="rounded-2xl border border-border bg-surface p-5">
                <div className="skeleton h-5 w-40 rounded" />
                <div className="mt-6 flex items-center gap-4">
                  <div className="skeleton size-[60px] rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-5 w-24 rounded" />
                    <div className="skeleton h-1.5 rounded-full" />
                  </div>
                </div>
                <div className="skeleton mt-4 h-12 rounded-xl" />
              </li>
            ))}
          </ul>
        ) : roles !== null && roles.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
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
          <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-16 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-foreground/[0.05] text-muted">
              <SearchX className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium">No roles match these filters</p>
            <button type="button" onClick={clearFilters} className="mt-3 text-sm font-medium text-accent hover:underline">
              Reset filters
            </button>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((role, index) => (
              <RoleCard
                key={role.id}
                role={role}
                index={index}
                counts={pipelineByRole[role.id] ?? null}
                candidates={candidatesByRole[role.id]}
                selected={selectedIds.has(role.id)}
                onSelect={(selected) => toggleSelected(role.id, selected)}
                onEdit={() => setSheet({ role })}
                onDelete={() => setDeleteIds([role.id])}
                onToast={setToast}
              />
            ))}
            <li>
              <button
                type="button"
                onClick={() => setSheet({ role: null })}
                className="grid h-full min-h-[200px] w-full place-items-center rounded-2xl border border-dashed border-border text-sm text-muted transition hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent"
              >
                <span className="flex flex-col items-center gap-2">
                  <span className="grid size-10 place-items-center rounded-full bg-foreground/[0.05]">
                    <Plus className="size-4" aria-hidden />
                  </span>
                  New role
                </span>
              </button>
            </li>
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
        busyLabel="Deleting…"
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
