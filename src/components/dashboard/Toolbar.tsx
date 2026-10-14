"use client";

import { Calendar, Search, SlidersHorizontal } from "lucide-react";

/**
 * Filter toolbar for the reports table: debounced search (owner debounce in
 * DashboardView), session status filter, date-range filter and a clear
 * action that appears only when a filter is active.
 */

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "waiting", label: "Waiting" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const DEFAULT_RANGE = "30";

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  range: string;
  onRangeChange: (value: string) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}

export function Toolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  range,
  onRangeChange,
  hasActiveFilters,
  onClear,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[240px] flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by candidate name, email, role, or recruiter…"
          aria-label="Search by candidate name, email, role, or recruiter"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <label className="relative">
        <span className="sr-only">Filter by session status</span>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          className="cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2.5 pl-4 pr-9 text-sm font-medium outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          Γû╛
        </span>
      </label>

      <label className="relative">
        <span className="sr-only">Filter by creation date range</span>
        <Calendar aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <select
          value={range}
          onChange={(event) => onRangeChange(event.target.value)}
          className="cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2.5 pl-9 pr-9 text-sm font-medium outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          Γû╛
        </span>
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:bg-background"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Clear filters
        </button>
      )}
    </div>
  );
}
