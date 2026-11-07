"use client";
// Reports table: shows the 0-100 overall score; thin-transcript reports carry a cost-savings note.

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { DashboardInterviewSummary } from "@/lib/dashboard/dashboard.types";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import { EASE_OUT } from "@/components/ui/animated";
import { Avatar, StatusBadge } from "./primitives";
import { Menu } from "./menu";

/**
 * The reports table: candidate/recruiter identities, server-sorted dates,
 * the report column's three honest states, session status badges, per-row
 * action menus (view / download / delete — deliberately no edit action) and
 * bulk-selection checkboxes scoped to the current page.
 */

export type ReportCellState = "ready" | "processing" | "not-started";

/**
 * The report column reflects what actually exists on the server: v2
 * generates the scorecard when the interview ends, so a completed session
 * without one is "awaiting analysis" and opens (generates) on first view.
 * `summary.reportReason` carries the per-row detail from the API.
 */
export function reportCell(summary: DashboardInterviewSummary): { state: ReportCellState; detail: string } {
  const { room, scorecard } = summary;
  if (scorecard) {
    // overallScore is the 1-5 competency mean; overall.score is the 0-100
    // four-factor score. Report both on the 0-100 scale the detail page uses.
    const percentScore =
      scorecard.overall?.score ??
      (scorecard.overallScore !== null
        ? Math.round((scorecard.overallScore / 5) * 100)
        : null);
    const detail =
      percentScore !== null
        ? `Score ${percentScore}/100 · ${scorecard.suggestion}`
        : "View report";
    return { state: "ready", detail };
  }
  const status = room.status as InterviewStatus;
  if (status === "active") return { state: "processing", detail: "Interview in progress" };
  if (status === "waiting") return { state: "processing", detail: "Candidate joining" };
  if (status === "completed") {
    return { state: "processing", detail: "Awaiting analysis — opens on first view" };
  }
  if (status === "scheduled") return { state: "not-started", detail: "Not started" };
  if (status === "expired") return { state: "not-started", detail: "Never joined" };
  if (status === "cancelled") return { state: "not-started", detail: "Cancelled" };
  return { state: "not-started", detail: "Interview not started" };
}


/** The 0-100 score when a report exists. */
function scoreOf(summary: DashboardInterviewSummary): number | null {
  const card = summary.scorecard;
  if (!card) return null;
  return card.overall?.score ?? (card.overallScore !== null ? Math.round((card.overallScore / 5) * 100) : null);
}

function scoreTone(score: number): { bar: string; text: string } {
  if (score >= 70) return { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" };
  if (score >= 50) return { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" };
  return { bar: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" };
}

interface ReportsTableProps {
  rows: DashboardInterviewSummary[];
  loading: boolean;
  skeletonCount: number;
  selected: ReadonlySet<string>;
  onToggleRow: (roomId: string) => void;
  onToggleAll: () => void;
  sortDir: "asc" | "desc";
  onSortToggle: () => void;
  onAction: (action: "view" | "download" | "edit" | "delete", roomId: string) => void;
}

const TH = "px-4 py-3 text-left text-xs font-medium text-muted";

export function ReportsTable({
  rows,
  loading,
  skeletonCount,
  selected,
  onToggleRow,
  onToggleAll,
  sortDir,
  onSortToggle,
  onAction,
}: ReportsTableProps) {
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const selectedOnPage = rows.filter((row) => selected.has(row.room.id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="relative overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead className="border-b border-border bg-foreground/[0.015]">
          <tr>
            <th scope="col" className="w-12 py-3 pl-5 pr-2">
              <Checkbox
                ref={headerCheckboxRef}
                checked={allSelected}
                onChange={onToggleAll}
                label={allSelected ? "Deselect all rows on this page" : `Select all ${rows.length} rows on this page`}
              />
            </th>
            <th scope="col" className={TH}>Candidate</th>
            <th scope="col" className={TH}>Role</th>
            <th scope="col" aria-sort={sortDir === "asc" ? "ascending" : "descending"} className={TH}>
              <button
                type="button"
                onClick={onSortToggle}
                className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-foreground/[0.05] hover:text-foreground"
                aria-label={`Sort by date, currently ${sortDir === "asc" ? "oldest first" : "newest first"}`}
              >
                Created
                {sortDir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
              </button>
            </th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={`${TH} w-44`}>Score</th>
            <th scope="col" className="w-24 py-3 pr-5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading
            ? Array.from({ length: skeletonCount }, (_, index) => <SkeletonRow key={index} />)
            : rows.map((summary) => (
                <Row
                  key={summary.room.id}
                  summary={summary}
                  selected={selected.has(summary.room.id)}
                  onToggle={() => onToggleRow(summary.room.id)}
                  onAction={onAction}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  summary,
  selected,
  onToggle,
  onAction,
}: {
  summary: DashboardInterviewSummary;
  selected: boolean;
  onToggle: () => void;
  onAction: ReportsTableProps["onAction"];
}) {
  const { room, scorecard } = summary;
  const name = room.candidateName ?? "Unnamed candidate";
  const status = room.status as InterviewStatus;
  const open = () => onAction("view", room.id);

  return (
    <tr
      onClick={open}
      className={`group cursor-pointer transition-colors ${selected ? "bg-accent-soft" : "hover:bg-foreground/[0.025]"}`}
    >
      <td className="py-3.5 pl-5 pr-2" onClick={(event) => event.stopPropagation()}>
        <Checkbox checked={selected} onChange={onToggle} label={`Select ${name}`} />
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={name} className="size-9 text-[13px]" />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{displayName(name)}</p>
            {room.candidateEmail && <p className="truncate text-xs text-muted">{room.candidateEmail}</p>}
          </div>
        </div>
      </td>
      <td className="max-w-[220px] px-4 py-3.5">
        <p className="truncate">{room.roleTitle ?? room.title}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-3.5">
        <p title={new Date(room.createdAt).toLocaleString()}>{relativeDay(room.createdAt)}</p>
        <p className="text-xs text-muted">
          {formatTime(room.createdAt)}
          {room.recruiterName ? `, by ${room.recruiterName}` : ""}
        </p>
      </td>
      <td className="px-4 py-3.5">
        <StatusBadge status={status} />
      </td>
      <td className="px-4 py-3.5">
        <ScoreCell summary={summary} />
      </td>
      <td className="py-3.5 pr-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Menu
            label={`Actions for ${name}`}
            align="end"
            trigger={
              <button
                type="button"
                aria-label={`Actions for ${name}`}
                className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            }
            items={[
              ...(scorecard
                ? [{ id: "download", label: "Download PDF", icon: <Download className="size-4" aria-hidden />, onSelect: () => onAction("download", room.id) }]
                : []),
              ...((status === "scheduled" || status === "expired") && !scorecard
                ? [{ id: "edit", label: "Edit interview", icon: <Pencil className="size-4" aria-hidden />, onSelect: () => onAction("edit", room.id) }]
                : []),
              { id: "delete", label: "Delete", icon: <Trash2 className="size-4" aria-hidden />, danger: true, onSelect: () => onAction("delete", room.id) },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

function ScoreCell({ summary }: { summary: DashboardInterviewSummary }) {
  const reduce = useReducedMotion();
  const score = scoreOf(summary);
  const cell = reportCell(summary);

  if (score !== null) {
    const tone = scoreTone(score);
    return (
      <div className="flex items-center gap-3">
        <span className={`w-7 text-sm font-semibold ${tone.text}`}>{score}</span>
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/[0.07]">
          <motion.span
            className={`block h-full rounded-full ${tone.bar}`}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.15 }}
          />
        </span>
      </div>
    );
  }
  if (cell.state === "ready") return <span className="text-sm text-muted">Report ready</span>;
  if (cell.state === "processing") return <span className="text-shimmer text-sm font-medium">{summary.room.status === "completed" ? "Writing report" : cell.detail}</span>;
  return <span className="text-muted">—</span>;
}

const Checkbox = function Checkbox({
  ref,
  checked,
  onChange,
  label,
}: {
  ref?: React.Ref<HTMLInputElement>;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-4 cursor-pointer rounded border-border accent-[var(--accent)]"
    />
  );
};

function SkeletonRow() {
  return (
    <tr aria-hidden>
      <td className="py-4 pl-5 pr-2"><div className="skeleton size-4 rounded" /></td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="skeleton size-9 rounded-full" />
          <div className="grid gap-1.5">
            <div className="skeleton h-3.5 w-28 rounded" />
            <div className="skeleton h-3 w-40 rounded" />
          </div>
        </div>
      </td>
      <td className="px-4 py-4"><div className="skeleton h-3.5 w-32 rounded" /></td>
      <td className="px-4 py-4"><div className="skeleton h-3.5 w-20 rounded" /></td>
      <td className="px-4 py-4"><div className="skeleton h-6 w-24 rounded-full" /></td>
      <td className="px-4 py-4"><div className="skeleton h-3.5 w-28 rounded" /></td>
      <td className="py-4 pr-5"><div className="skeleton ml-auto size-8 rounded-lg" /></td>
    </tr>
  );
}

/** "PRANJUL GUPTA" reads as shouting in a list; show it in title case. */
function displayName(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  return name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function relativeDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
