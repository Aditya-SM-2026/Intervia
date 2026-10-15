"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  Brain,
  ChevronDown,
  Clock3,
  ClipboardList,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileBarChart,
  Filter,
  Layers,
  LayoutGrid,
  List,
  Search,
  Settings,
  Star,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import type {
  RoleCandidateSummary,
  RoleCandidatesResponse,
  RoleStatus,
  RoleSummary,
  RolesResponse,
} from "@/lib/roles/role.types";
import {
  compareByHirePriority,
  deriveHireStage,
  HIRE_STAGE_LABELS,
  HIRE_STAGE_STYLES,
  type HireStage,
} from "@/lib/roles/hire-stage";
import { Menu } from "@/components/dashboard/menu";

/**
 * Roles workspace, built the way HR reads it:
 *  - summary cards from real role/interview aggregates (no invented trends),
 *  - search across roles and candidates, filters by role status and hire
 *    stage, and a sort,
 *  - card view (rich role cards with expandable candidate tables) and a
 *    compact list view for comparing many roles,
 *  - per-role actions: share an invite link (the existing invitation
 *    workflow, pre-filled) and manage the role; per-candidate: report and
 *    profile links only — no duplicated screens.
 * Data comes from GET /api/roles and GET /api/roles/[id]/candidates.
 */

const STATUS_LABELS: Record<RoleStatus, string> = {
  open: "Open",
  completed: "Completed",
};

const STATUS_STYLES: Record<RoleStatus, string> = {
  open: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-border bg-surface text-muted",
};

/** Sorts offered in the toolbar; "Last updated" is the default. */
const SORT_OPTIONS = [
  { value: "updated", label: "Last updated" },
  { value: "candidates", label: "Most candidates" },
  { value: "score", label: "Highest average score" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["value"];

/** Deterministic role icon + colour so each card is visually distinct. */
const ROLE_ICONS = [
  { icon: Code2, classes: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" },
  { icon: Database, classes: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400" },
  { icon: Brain, classes: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" },
  { icon: Star, classes: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" },
  { icon: Users, classes: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400" },
  { icon: ClipboardList, classes: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400" },
];

function roleVisual(title: string) {
  let hash = 0;
  for (let index = 0; index < title.length; index++) hash = (hash * 31 + title.charCodeAt(index)) | 0;
  const entry = ROLE_ICONS[Math.abs(hash) % ROLE_ICONS.length];
  return { Icon: entry.icon, classes: entry.classes };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
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

async function fetchRoles(): Promise<RoleSummary[]> {
  const response = await fetch("/api/roles?");
  const data = (await response.json()) as RolesResponse & { error?: { message?: string } };
  if (!response.ok || !data.roles) {
    throw new Error(data.error?.message ?? "Could not load the roles. Please try again.");
  }
  return data.roles;
}

async function fetchCandidates(roleId: string): Promise<RoleCandidateSummary[]> {
  const response = await fetch(`/api/roles/${roleId}/candidates?limit=50&offset=0`);
  const data = (await response.json()) as RoleCandidatesResponse & { error?: { message?: string } };
  if (!response.ok || !data.candidates) {
    throw new Error(data.error?.message ?? "Could not load the candidates.");
  }
  return data.candidates;
}

/** Invite deep-link: the existing recruiter flow with the role pre-filled. */
function inviteUrl(role: RoleSummary): string {
  return `/recruiter?role=${encodeURIComponent(role.title)}`;
}

interface SummaryCardData {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconClasses: string;
  cardClasses: string;
}

function SummaryCard({ data }: { data: SummaryCardData }) {
  return (
    <div className={`rounded-2xl border border-border p-4 sm:p-5 ${data.cardClasses}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${data.iconClasses}`}>
          {data.icon}
        </span>
        <p className="text-sm font-medium">{data.label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{data.value}</p>
    </div>
  );
}

/** Candidate row stage, shared by both views. */
function StageBadge({ stage }: { stage: HireStage }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${HIRE_STAGE_STYLES[stage]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {HIRE_STAGE_LABELS[stage]}
    </span>
  );
}

interface RankedCandidate {
  candidate: RoleCandidateSummary;
  stage: HireStage;
}

function rankCandidates(candidates: RoleCandidateSummary[]): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      stage: deriveHireStage({
        status: candidate.latestStatus,
        overallScore: candidate.overallScore,
        decision: candidate.decision?.outcome ?? null,
        cutoff: null,
      }) as HireStage,
    }))
    .sort((a, b) =>
      compareByHirePriority(
        { stage: a.stage, overallScore: a.candidate.overallScore },
        { stage: b.stage, overallScore: b.candidate.overallScore },
      ),
    );
}

/** Expandable candidate table inside one role card. */
function CandidateTable({
  roleId,
  candidates,
  loading,
  error,
}: {
  roleId: string;
  candidates: RoleCandidateSummary[] | null;
  loading: boolean;
  error: string | null;
}) {
  const router = useRouter();
  if (error) {
    return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (loading || candidates === null) {
    return (
      <div aria-hidden className="space-y-2">
        <div className="h-11 animate-pulse rounded-md border border-border bg-background" />
        <div className="h-11 animate-pulse rounded-md border border-border bg-background" />
      </div>
    );
  }
  const ranked = rankCandidates(candidates);
  if (ranked.length === 0) {
    return (
      <p className="rounded-lg bg-background px-3 py-4 text-sm text-muted">
        No candidates have interviewed for this role yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">Candidate</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Score</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Stage</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Last interview</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ candidate, stage }) => (
            <tr key={candidate.candidateId} className="border-b border-border transition last:border-b-0 hover:bg-background">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                    {initials(candidate.candidateName ?? candidate.candidateEmail)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{candidate.candidateName ?? "Unnamed candidate"}</span>
                    <span className="block truncate text-xs text-muted">{candidate.candidateEmail}</span>
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                {candidate.overallScore === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${scoreBadgeClass(candidate.overallScore)}`}>
                    {candidate.overallScore}/100
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <StageBadge stage={stage} />
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {formatDate(candidate.latestInterviewAt)}
                <span className="block">{relativeDate(candidate.latestInterviewAt)}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/dashboard/${candidate.latestInterviewId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/5"
                  >
                    View report
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                  <Menu
                    label={`Actions for ${candidate.candidateName ?? candidate.candidateEmail}`}
                    align="end"
                    trigger={
                      <button
                        type="button"
                        aria-label={`More actions for ${candidate.candidateName ?? candidate.candidateEmail}`}
                        className="grid size-8 place-items-center rounded-lg border border-transparent text-muted transition hover:border-border hover:bg-background hover:text-foreground"
                      >
                        <span aria-hidden className="text-base leading-none">⋯</span>
                      </button>
                    }
                    items={[
                      {
                        id: "profile",
                        label: "Open candidate profile",
                        onSelect: () => router.push(`/dashboard/roles/${roleId}/candidates/${encodeURIComponent(candidate.candidateId)}`),
                      },
                    ]}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One role card in card view. */
function RoleCard({
  role,
  candidates,
  candidatesLoading,
  candidatesError,
  onToggle,
  expanded,
  onNotice,
  onEdit,
}: {
  role: RoleSummary;
  candidates: RoleCandidateSummary[] | null;
  candidatesLoading: boolean;
  candidatesError: string | null;
  onToggle: () => void;
  expanded: boolean;
  onNotice: (message: string) => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { Icon, classes } = roleVisual(role.title);

  function copyInvite() {
    const url = `${window.location.origin}${inviteUrl(role)}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => onNotice("Invite link copied — it opens the interview form with this role pre-filled."))
      .catch(() => onNotice(url));
  }

  return (
    <li className="rounded-2xl border border-border bg-surface transition hover:border-accent/40 hover:shadow-sm">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <span aria-hidden className={`grid size-12 shrink-0 place-items-center rounded-xl ${classes}`}>
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{role.title}</h3>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[role.status]}`}>
                {STATUS_LABELS[role.status]}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden />
                <strong className="font-semibold text-foreground">{role.stats.candidates}</strong>
                {role.stats.candidates === 1 ? "candidate" : "candidates"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ClipboardList className="size-3.5" aria-hidden />
                <strong className="font-semibold text-foreground">{role.stats.interviews}</strong>
                {role.stats.interviews === 1 ? "interview" : "interviews"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="size-3.5" aria-hidden />
                <strong className="font-semibold text-foreground">{role.stats.completed}</strong> scored
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" aria-hidden />
                <strong className="font-semibold text-foreground">{role.stats.pending}</strong> pending
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileBarChart className="size-3.5" aria-hidden />
                Avg score{" "}
                <strong className="font-semibold text-foreground">
                  {role.stats.avgOverallScore === null ? "—" : `${role.stats.avgOverallScore}/100`}
                </strong>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted sm:block">Created {formatDate(role.createdAt)}</span>
              <Menu
                label={`Role actions for ${role.title}`}
                align="end"
                trigger={
                  <button
                    type="button"
                    aria-label={`Role actions for ${role.title}`}
                    className="grid size-8 place-items-center rounded-lg border border-transparent text-muted transition hover:border-border hover:bg-background hover:text-foreground"
                  >
                    <span aria-hidden className="text-base leading-none">⋯</span>
                  </button>
                }
                items={[
                  {
                    id: "edit",
                    label: "Edit role",
                    onSelect: onEdit,
                  },
                  {
                    id: "manage",
                    label: "Manage role",
                    onSelect: () => router.push(`/dashboard/roles/${role.id}`),
                  },
                  { id: "share", label: "Copy invite link", onSelect: copyInvite },
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyInvite}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium transition hover:bg-background"
              >
                <Copy className="size-4" aria-hidden />
                Share link
              </button>
              <Link
                href={`/dashboard/roles/${role.id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                <Settings className="size-4" aria-hidden />
                Manage role
              </Link>
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={expanded ? `Hide candidates for ${role.title}` : `Show candidates for ${role.title}`}
                className="grid size-9 place-items-center rounded-xl border border-border text-muted transition hover:bg-background hover:text-foreground"
              >
                <ChevronDown className={`size-4 transition ${expanded ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border p-4 sm:px-5">
          <CandidateTable roleId={role.id} candidates={candidates} loading={candidatesLoading} error={candidatesError} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background px-3 py-2.5">
            <Link
              href={inviteUrl(role)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition hover:bg-background"
            >
              <UserPlus className="size-4" aria-hidden />
              Add candidate
            </Link>
            <p className="text-xs text-muted">Invite candidates via a shareable interview link or add manually.</p>
            <Link
              href={`/dashboard/roles/${role.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              Open full role view
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

/** Compact comparison table for many roles. */
function RolesListView({ roles }: { roles: RoleSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-3 font-medium">Role</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Candidates</th>
            <th scope="col" className="px-4 py-3 font-medium">Interviews</th>
            <th scope="col" className="px-4 py-3 font-medium">Completed</th>
            <th scope="col" className="px-4 py-3 font-medium">Avg score</th>
            <th scope="col" className="px-4 py-3 font-medium">Updated</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id} className="border-b border-border transition last:border-b-0 hover:bg-background">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  {(() => {
                    const { Icon, classes } = roleVisual(role.title);
                    return (
                      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${classes}`}>
                        <Icon className="size-4" />
                      </span>
                    );
                  })()}
                  <Link href={`/dashboard/roles/${role.id}`} className="truncate font-medium hover:text-accent">
                    {role.title}
                  </Link>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[role.status]}`}>
                  {STATUS_LABELS[role.status]}
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums">{role.stats.candidates}</td>
              <td className="px-4 py-3 tabular-nums">{role.stats.interviews}</td>
              <td className="px-4 py-3 tabular-nums">
                {role.stats.completed}
                {role.stats.pending > 0 && <span className="text-muted"> · {role.stats.pending} pending</span>}
              </td>
              <td className="px-4 py-3 tabular-nums">
                {role.stats.avgOverallScore === null ? "—" : `${role.stats.avgOverallScore}/100`}
              </td>
              <td className="px-4 py-3 text-xs text-muted">{formatDate(role.updatedAt)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/dashboard/roles/${role.id}`}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/5"
                  >
                    Manage
                  </Link>
                  <Link
                    href={inviteUrl(role)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-background"
                  >
                    Add candidate
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Summary cards (real aggregates) are parked for now — flip to true when we
 * want them back (e.g. once month-over-month trends have real data).
 */
const SHOW_SUMMARY_CARDS = false;

/** Inline edit form for one role, pre-filled with its current values. */
function RoleEditForm({
  role,
  onSaved,
  onCancel,
}: {
  role: RoleSummary;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const skills = String(data.get("skills") ?? "")
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill !== "");
    const deadline = String(data.get("deadline") ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Absent fields keep their value; we always send every editable field
        // because the form shows them all. An empty deadline clears it.
        body: JSON.stringify({
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
          skills,
          deadline: deadline === "" ? null : deadline,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not save the role.");
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-accent/40 bg-surface p-5" aria-label={`Edit role ${role.title}`}>
      <h3 className="mb-4 text-base font-semibold">Edit role</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Role title *</span>
          <input
            name="title"
            required
            minLength={2}
            maxLength={120}
            defaultValue={role.title}
            className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Hiring deadline (optional)</span>
          <input
            name="deadline"
            type="date"
            defaultValue={role.deadline ?? ""}
            className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Job description *</span>
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={20000}
            rows={4}
            defaultValue={role.description}
            className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Skills &amp; qualifications (comma-separated, optional)</span>
          <input
            name="skills"
            defaultValue={role.skills.join(", ")}
            placeholder="e.g. Go, PostgreSQL, Kubernetes"
            className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-background"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RolesView() {
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RoleStatus | "">("");
  const [stageFilter, setStageFilter] = useState<HireStage | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const [view, setView] = useState<"card" | "list">("card");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [candidatesByRole, setCandidatesByRole] = useState<Record<string, RoleCandidateSummary[] | null>>({});
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    fetchRoles()
      .then((result) => {
        setRoles(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  useEffect(() => {
    load();
  }, []);

  // Debounce the search box.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load every role's candidates once: stage filtering and candidate search
  // need them, and cards reuse the cache when expanded.
  useEffect(() => {
    if (roles === null) return;
    let cancelled = false;
    void Promise.allSettled(roles.map((role) => fetchCandidates(role.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, RoleCandidateSummary[] | null> = {};
      const errors: Record<string, string> = {};
      results.forEach((result, index) => {
        const id = roles[index].id;
        if (result.status === "fulfilled") next[id] = result.value;
        else {
          next[id] = null;
          errors[id] = "Could not load the candidates.";
        }
      });
      setCandidatesByRole(next);
      setCandidateErrors(errors);
    });
    return () => {
      cancelled = true;
    };
  }, [roles]);

  /** One ranked list per role, memoised once candidates arrive. */
  const rankedByRole = useMemo(() => {
    const map: Record<string, RankedCandidate[]> = {};
    for (const role of roles ?? []) {
      const candidates = candidatesByRole[role.id];
      map[role.id] = candidates ? rankCandidates(candidates) : [];
    }
    return map;
  }, [roles, candidatesByRole]);

  const filtered = useMemo(() => {
    let list = roles ?? [];
    const term = search.toLowerCase();
    if (term) {
      list = list.filter((role) => {
        const roleMatch =
          role.title.toLowerCase().includes(term) ||
          role.description.toLowerCase().includes(term) ||
          role.skills.some((skill) => skill.toLowerCase().includes(term));
        const candidateMatch = (rankedByRole[role.id] ?? []).some(
          (row) =>
            (row.candidate.candidateName ?? "").toLowerCase().includes(term) ||
            row.candidate.candidateEmail.toLowerCase().includes(term),
        );
        return roleMatch || candidateMatch;
      });
    }
    if (statusFilter) list = list.filter((role) => role.status === statusFilter);
    if (stageFilter) {
      list = list.filter((role) => (rankedByRole[role.id] ?? []).some((row) => row.stage === stageFilter));
    }
    return [...list].sort((a, b) => {
      if (sortBy === "candidates") return b.stats.candidates - a.stats.candidates;
      if (sortBy === "score") return (b.stats.avgOverallScore ?? -1) - (a.stats.avgOverallScore ?? -1);
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }, [roles, search, statusFilter, stageFilter, sortBy, rankedByRole]);

  /** Summary cards from real aggregates across the (unfiltered) role list. */
  const cards = useMemo<SummaryCardData[]>(() => {
    const list = roles ?? [];
    const totalRoles = list.length;
    const totalCandidates = list.reduce((sum, role) => sum + role.stats.candidates, 0);
    const completedInterviews = list.reduce((sum, role) => sum + role.stats.completed, 0);
    const scoreSum = list.reduce((sum, role) => sum + (role.stats.avgOverallScore ?? 0) * role.stats.completed, 0);
    const scoredCount = list.reduce((sum, role) => sum + role.stats.completed, 0);
    const avgScore = scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null;
    return [
      {
        label: "Total roles",
        value: String(totalRoles),
        icon: <Users className="size-5" aria-hidden />,
        iconClasses: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
        cardClasses: "bg-blue-50/60 dark:bg-blue-500/5",
      },
      {
        label: "Total candidates",
        value: String(totalCandidates),
        icon: <ClipboardList className="size-5" aria-hidden />,
        iconClasses: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
        cardClasses: "bg-violet-50/60 dark:bg-violet-500/5",
      },
      {
        label: "Completed interviews",
        value: String(completedInterviews),
        icon: <Trophy className="size-5" aria-hidden />,
        iconClasses: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
        cardClasses: "bg-emerald-50/60 dark:bg-emerald-500/5",
      },
      {
        label: "Average score",
        value: avgScore === null ? "—" : `${avgScore}/100`,
        icon: <Star className="size-5" aria-hidden />,
        iconClasses: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
        cardClasses: "bg-amber-50/60 dark:bg-amber-500/5",
      },
    ];
  }, [roles]);

  function toggleExpanded(roleId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // no duplicate submissions
    const form = event.currentTarget;
    const data = new FormData(form);
    const skills = String(data.get("skills") ?? "")
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill !== "");
    const deadline = String(data.get("deadline") ?? "").trim();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
          skills,
          deadline: deadline === "" ? null : deadline,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not create the role.");
      }
      form.reset();
      setShowForm(false);
      setNotice("Role created.");
      await load();
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const candidatesReady = roles !== null && Object.keys(candidateErrors).length + Object.keys(candidatesByRole).length >= roles.length;
  const hasActiveFilters = search !== "" || statusFilter !== "" || stageFilter !== "";

  return (
    <div className="grid gap-5">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Roles</h1>
          <p className="mt-1 text-muted">Manage your hiring roles, track candidates, and analyze interview results.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((open) => !open);
            setFormError(null);
          }}
          aria-expanded={showForm}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          {showForm ? "Cancel" : "New role"}
        </button>
      </div>

      {notice && (
        <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {/* Summary cards (real aggregates) — parked; see SHOW_SUMMARY_CARDS. */}
      {SHOW_SUMMARY_CARDS && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <SummaryCard key={card.label} data={card} />
          ))}
        </div>
      )}

      {/* Toolbar: search, filters, sort, view switch */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search roles or candidates..."
            aria-label="Search roles or candidates"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <label className="relative">
          <span className="sr-only">Filter by role status</span>
          <Filter aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as RoleStatus | "")}
            aria-label="Filter by role status"
            className="cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-accent"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        </label>
        <label className="relative">
          <span className="sr-only">Filter by interview stage</span>
          <Layers aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value as HireStage | "")}
            aria-label="Filter by interview stage"
            className="cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-accent"
            disabled={!candidatesReady && (roles?.length ?? 0) > 0}
          >
            <option value="">All stages</option>
            {Object.entries(HIRE_STAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        </label>
        <label className="relative">
          <span className="sr-only">Sort roles</span>
          <ArrowUpDown aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortKey)}
            aria-label="Sort roles"
            className="cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-accent"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        </label>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setStatusFilter("");
              setStageFilter("");
            }}
            className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:bg-background"
          >
            Clear filters
          </button>
        )}
        <div className="grow" />
        <div role="group" aria-label="View mode" className="flex items-center rounded-xl border border-border bg-surface p-1">
          <button
            type="button"
            aria-pressed={view === "card"}
            onClick={() => setView("card")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === "card" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <LayoutGrid className="size-4" aria-hidden />
            Card view
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === "list" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <List className="size-4" aria-hidden />
            List view
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={createRole}
          className="rounded-2xl border border-border bg-surface p-5"
          aria-label="Create role"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Role title *</span>
              <input
                name="title"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Senior Backend Engineer"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Hiring deadline (optional)</span>
              <input
                name="deadline"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Job description *</span>
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={20000}
                rows={4}
                placeholder="What the person will do, the team, and what success looks like."
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Skills &amp; qualifications (comma-separated, optional)</span>
              <input
                name="skills"
                placeholder="e.g. Go, PostgreSQL, Kubernetes"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {submitting ? "Creating…" : "Create role"}
            </button>
            {submitting && <span className="text-sm text-muted">Saving…</span>}
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {roles !== null && roles.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-medium">No roles yet</p>
          <p className="mt-1 text-sm text-muted">Create your first role, then invite candidates to interview for it.</p>
        </div>
      )}

      {roles !== null && roles.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-medium">No roles match your filters</p>
          <p className="mt-1 text-sm text-muted">Try a different search term, status or stage.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {view === "card" ? (
            <ul className="grid gap-4">
              {filtered.map((role) => (
                <li key={role.id} className="grid gap-4">
                  {editingId === role.id ? (
                    <RoleEditForm
                      role={role}
                      onSaved={() => {
                        setEditingId(null);
                        setNotice("Role updated.");
                        load();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <RoleCard
                      role={role}
                      candidates={candidatesByRole[role.id] ?? null}
                      candidatesLoading={!candidatesReady && candidatesByRole[role.id] === undefined}
                      candidatesError={candidateErrors[role.id] ?? null}
                      expanded={expandedIds.has(role.id)}
                      onToggle={() => toggleExpanded(role.id)}
                      onNotice={setNotice}
                      onEdit={() => setEditingId(role.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <RolesListView roles={filtered} />
          )}
        </>
      )}
    </div>
  );
}