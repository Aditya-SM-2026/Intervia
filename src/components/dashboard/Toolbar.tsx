"use client";

import { Briefcase, Calendar, Check, ChevronDown, Download, Search, X } from "lucide-react";
import { SegmentedTabs } from "@/components/ui/animated";
import { Menu } from "./menu";

/**
 * Filter bar for the interviews list: status as tabs (the filter people
 * switch most), then search, date range and role as quiet dropdowns, and
 * export at the end. The parent debounces search.
 */

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "In progress" },
  { value: "expired", label: "Expired" },
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
  roleOptions: string[];
  role: string;
  onRoleChange: (value: string) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
  onExport: () => void;
}

export function Toolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  range,
  onRangeChange,
  roleOptions,
  role,
  onRoleChange,
  hasActiveFilters,
  onClear,
  onExport,
}: ToolbarProps) {
  // Statuses outside the tabs (waiting, cancelled) still filter correctly;
  // the tabs then show no selection.
  const tabValue = STATUS_TABS.some((tab) => tab.value === status) ? status : "__other";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="-mx-1 overflow-x-auto px-1">
        <SegmentedTabs
          id="interview-status"
          label="Filter by status"
          options={STATUS_TABS}
          value={tabValue}
          onChange={onStatusChange}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Find a candidate or role"
            aria-label="Search by candidate name, email, role, or recruiter"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition placeholder:text-muted hover:border-foreground/20 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:w-60"
          />
        </div>

        <FilterMenu
          label="Date range"
          icon={<Calendar className="size-4" aria-hidden />}
          value={range}
          options={RANGE_OPTIONS}
          onChange={onRangeChange}
        />

        <FilterMenu
          label="Role"
          icon={<Briefcase className="size-4" aria-hidden />}
          value={role}
          options={[{ value: "", label: "All roles" }, ...roleOptions.map((title) => ({ value: title, label: title }))]}
          onChange={onRoleChange}
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
            Reset
          </button>
        )}

        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />

        <button
          type="button"
          onClick={onExport}
          title="Download every interview that matches these filters as a spreadsheet"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]"
        >
          <Download className="size-4 text-muted" aria-hidden />
          Export
        </button>
      </div>
    </div>
  );
}

export function FilterMenu({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <Menu
      label={label}
      align="end"
      panelClassName="max-h-80 overflow-y-auto min-w-52"
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${current?.label ?? ""}`}
          className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]"
        >
          <span className="text-muted">{icon}</span>
          <span className="truncate">{current?.label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
        </button>
      }
      items={options.map((option) => ({
        id: option.value || "__all",
        label: option.label,
        icon: option.value === value ? <Check className="size-4 text-accent" aria-hidden /> : <span />,
        onSelect: () => onChange(option.value),
      }))}
    />
  );
}
