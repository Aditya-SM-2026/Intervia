"use client";
// Reports table: shows the 0-100 overall score; thin-transcript reports carry a cost-savings note.

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { DashboardInterviewSummary } from "@/lib/dashboard/dashboard.types";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
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

const REPORT_STATE_STYLES: Record<ReportCellState, { dot: string; label: string }> = {
  ready: { dot: "bg-emerald-500", label: "Ready" },
  processing: { dot: "bg-amber-500", label: "Processing" },
  "not-started": { dot: "bg-muted", label: "Not started" },
};

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
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const selectAllLabel = allSelected
    ? "Deselect all rows on this page"
    : someSelected
      ? `${selectedOnPage} of ${rows.length} rows on this page selected`
      : `Select all ${rows.length} rows on this page`;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="w-12 px-4 py-3">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={selectAllLabel}
                title="Select all rows on this page"
                className="size-4 cursor-pointer accent-[var(--accent)]"
              />
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Candidate / Role
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Recruiter
            </th>
            <th
              scope="col"
              aria-sort={sortDir === "asc" ? "ascending" : "descending"}
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              <button
                type="button"
                onClick={onSortToggle}
                className="inline-flex items-center gap-1.5 uppercase tracking-wide transition hover:text-foreground"
                aria-label={`Sort by date, currently ${sortDir === "asc" ? "oldest first" : "newest first"}`}
              >
                Date
                {sortDir === "asc" ? (
                  <ArrowUp className="size-3.5" aria-hidden />
                ) : sortDir === "desc" ? (
                  <ArrowDown className="size-3.5" aria-hidden />
                ) : (
                  <ArrowUpDown className="size-3.5" aria-hidden />
                )}
              </button>
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Report
            </th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Status
            </th>
            <th scope="col" className="w-16 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonCount }, (_, index) => <SkeletonRow key={index} />)
            : rows.map((summary) => {
                const { room, scorecard } = summary;
                const cell = reportCell(summary);
                const isSelected = selected.has(room.id);
                return (
                  <tr
                    key={room.id}
                    onClick={scorecard ? () => onAction("view", room.id) : undefined}
                    className={`border-b border-border transition last:border-b-0 hover:bg-background ${
                      isSelected ? "bg-accent-soft" : ""
                    } ${scorecard ? "cursor-pointer" : ""}`}
                  >
                    <td className="px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow(room.id)}
                        aria-label={`Select interview for ${room.candidateName ?? room.roleTitle ?? room.title}`}
                        className="size-4 cursor-pointer accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={room.candidateName ?? room.roleTitle ?? room.title} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{room.candidateName ?? "Candidate name not set"}</p>
                          <p className="truncate text-xs text-muted">{room.roleTitle ?? room.title}</p>
                          {room.candidateEmail && (
                            <p className="truncate text-xs text-muted">{room.candidateEmail}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={room.recruiterName ?? "Recruiter"} className="size-9" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{room.recruiterName ?? "Recruiter not set"}</p>
                          <p className="text-xs text-muted">Recruiter</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <p>{formatDate(room.createdAt)}</p>
                      <p className="text-xs text-muted">{formatTime(room.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span aria-hidden className={`size-2 rounded-full ${REPORT_STATE_STYLES[cell.state].dot}`} />
                        <span className="font-medium">{REPORT_STATE_STYLES[cell.state].label}</span>
                      </div>
                      {cell.state === "ready" ? (
                        <>
                          <Link
                            href={`/dashboard/${room.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                          >
                            View report
                            <span aria-hidden className="text-[10px]">↗</span>
                          </Link>
                          <p className="mt-0.5 text-xs text-muted">{cell.detail}</p>
                        </>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted">{cell.detail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={room.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                      <Menu
                        label={`Actions for ${room.candidateName ?? room.title}`}
                        align="end"
                        trigger={
                          <button
                            type="button"
                            aria-label={`Actions for ${room.candidateName ?? room.title}`}
                            className="grid size-8 place-items-center rounded-lg border border-border text-muted transition hover:bg-background hover:text-foreground"
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </button>
                        }
                        items={[
                          { id: "view", label: "View report", icon: <Eye className="size-4" aria-hidden />, onSelect: () => onAction("view", room.id) },
                          ...(scorecard
                            ? [{
                                id: "download",
                                label: "Download report",
                                icon: <Download className="size-4" aria-hidden />,
                                onSelect: () => onAction("download", room.id),
                              }]
                            : []),
                          // Editing is open only while the interview is still
                          // scheduled and the candidate has not started it.
                          ...(room.status === "scheduled" && !scorecard
                            ? [{
                                id: "edit",
                                label: "Edit interview",
                                icon: <Pencil className="size-4" aria-hidden />,
                                onSelect: () => onAction("edit", room.id),
                              }]
                            : []),
                          {
                            id: "delete",
                            label: "Delete",
                            icon: <Trash2 className="size-4" aria-hidden />,
                            danger: true,
                            separatorAfter: true,
                            onSelect: () => onAction("delete", room.id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border last:border-b-0" aria-hidden>
      <td className="px-4 py-4"><div className="size-4 animate-pulse rounded bg-background" /></td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-full bg-background" />
          <div className="grid gap-1.5">
            <div className="h-3.5 w-28 animate-pulse rounded bg-background" />
            <div className="h-3 w-40 animate-pulse rounded bg-background" />
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="size-9 animate-pulse rounded-full bg-background" />
          <div className="h-3.5 w-20 animate-pulse rounded bg-background" />
        </div>
      </td>
      <td className="px-4 py-4"><div className="h-3.5 w-20 animate-pulse rounded bg-background" /></td>
      <td className="px-4 py-4"><div className="h-3.5 w-24 animate-pulse rounded bg-background" /></td>
      <td className="px-4 py-4"><div className="h-6 w-20 animate-pulse rounded-full bg-background" /></td>
      <td className="px-4 py-4"><div className="ml-auto h-8 w-8 animate-pulse rounded-lg bg-background" /></td>
    </tr>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
