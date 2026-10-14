"use client";

import type { InterviewStatus } from "@/lib/interviews/interview.types";
import { TrendingDown, TrendingUp } from "lucide-react";

/**
 * Small presentational primitives shared by the dashboard: deterministic
 * pastel avatars, session status badges, and real-data sparklines/metric
 * cards. Sparklines and trends render only from genuine values passed in —
 * nothing here invents a number.
 */

const AVATAR_TINTS = [
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
];

function tintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

export function Avatar({ name, className }: { name: string | null; className?: string }) {
  const label = (name ?? "?").trim();
  const initial = label.charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full text-sm font-semibold ${tintFor(label)} ${className ?? "size-10"}`}
    >
      {initial}
    </span>
  );
}

const STATUS_BADGE_STYLES: Record<InterviewStatus, string> = {
  scheduled: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  waiting: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  expired: "border-border bg-surface text-muted",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  waiting: "Waiting",
  active: "Active",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Polylined mini-chart of genuine per-day values; hidden when all zeros. */
export function Sparkline({ values, stroke, fill }: { values: number[]; stroke: string; fill: string }) {
  if (values.length < 2 || Math.max(...values) === 0) return null;
  const width = 100;
  const height = 42;
  const max = Math.max(...values);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 4 - (value / max) * (height - 10);
    return `${x},${y}`;
  });
  const gradientId = `spark-${stroke.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="hidden shrink-0 lg:block">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.35" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface MetricCardData {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconClasses: string;
  /** Percentage change vs the previous period; null when no prior data exists. */
  trend: number | null;
  trendLabel: string;
  /** "%" for relative changes, "pp" for completion-rate point differences. */
  trendUnit?: string;
  /** Genuine recent series — the sparkline is omitted when none exists. */
  series?: number[];
  seriesColor?: { stroke: string; fill: string };
}

export function MetricCard({ data }: { data: MetricCardData }) {
  const trendTone =
    data.trend !== null && data.trend < 0
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";
  const TrendIcon = data.trend !== null && data.trend < 0 ? TrendingDown : TrendingUp;
  const unit = data.trendUnit ?? "%";
  return (
    <div className="flex items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm transition hover:shadow-md hover:border-accent/30">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl ring-1 ring-black/[0.04] ring-inset dark:ring-white/10 ${data.iconClasses}`}
        >
          {data.icon}
        </span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-sm text-muted">{data.label}</p>
          <p className="mt-0.5 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {data.value}
          </p>
          {data.trend !== null && (
            <p className="mt-1 flex items-center gap-1.5 text-xs">
              <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${trendTone}`}>
                <TrendIcon className="size-3.5" aria-hidden />
                {data.trend >= 0 ? "+" : ""}
                {data.trend}
                {unit}
              </span>
              <span className="truncate text-muted">{data.trendLabel}</span>
            </p>
          )}
        </div>
      </div>
      {data.series && data.seriesColor && (
        <Sparkline values={data.series} stroke={data.seriesColor.stroke} fill={data.seriesColor.fill} />
      )}
    </div>
  );
}
