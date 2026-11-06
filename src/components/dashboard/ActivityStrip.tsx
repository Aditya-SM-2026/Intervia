"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
import { EASE_OUT, NumberTicker } from "@/components/ui/animated";

/**
 * The page's one moment of motion: the last 14 days drawn as paired bars
 * (interviews held, reports ready) that rise in sequence, next to the three
 * figures a recruiter checks first. One panel with ruled columns rather than
 * a row of identical cards.
 */
export function ActivityStrip({ analytics }: { analytics: DashboardAnalytics | null }) {
  if (!analytics) return <ActivityStripSkeleton />;

  return (
    <section
      aria-label="Overview"
      className="grid overflow-hidden rounded-3xl border border-border bg-surface lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
    >
      <ActivityChart analytics={analytics} />
      <div className="grid border-t border-border sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0">
        <Figure
          label="Interviews"
          value={analytics.total}
          trend={analytics.trends.total}
          hint="All time"
        />
        <Figure
          label="Reports ready"
          value={analytics.completionRate}
          suffix="%"
          trend={analytics.trends.completionRate}
          trendUnit="pts"
          hint={`${analytics.reportsReady} of ${analytics.total} interviews`}
        />
        <AwaitingFigure analytics={analytics} />
      </div>
    </section>
  );
}

function ActivityChart({ analytics }: { analytics: DashboardAnalytics }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const series = analytics.series;
  const max = Math.max(1, ...series.map((point) => Math.max(point.interviews, point.reports)));
  const active = hover !== null ? series[hover] : null;

  return (
    <div className="flex flex-col p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Daily activity</h2>
          <p className="mt-0.5 text-sm text-muted">
            {active
              ? `${formatDay(active.date)}: ${active.interviews} interview${active.interviews === 1 ? "" : "s"}, ${active.reports} report${active.reports === 1 ? "" : "s"}`
              : "Last 14 days"}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent" aria-hidden />
            Interviews
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-gold" aria-hidden />
            Reports
          </span>
        </div>
      </div>

      <div
        className="mt-6 flex h-40 items-end gap-1.5 sm:gap-2"
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Interviews and reports per day over the last ${series.length} days`}
      >
        {series.map((point, index) => {
          const dim = hover !== null && hover !== index;
          return (
            <div
              key={point.date}
              onPointerEnter={() => setHover(index)}
              className="group relative flex h-full flex-1 items-end justify-center gap-[3px]"
            >
              <span
                aria-hidden
                className={`absolute inset-x-0 -bottom-1 top-0 rounded-lg transition-colors ${hover === index ? "bg-foreground/[0.04]" : ""}`}
              />
              <Bar
                height={point.interviews / max}
                delay={index * 0.035}
                reduce={reduce}
                className={`bg-accent ${dim ? "opacity-35" : ""}`}
              />
              <Bar
                height={point.reports / max}
                delay={index * 0.035 + 0.08}
                reduce={reduce}
                className={`bg-gold ${dim ? "opacity-35" : ""}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex justify-between text-[11px] text-muted">
        <span>{series[0] ? formatDay(series[0].date) : ""}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Bar({
  height,
  delay,
  reduce,
  className,
}: {
  height: number;
  delay: number;
  reduce: boolean | null;
  className: string;
}) {
  // An empty day still shows a sliver, so the time axis reads as continuous.
  const pct = height === 0 ? 3 : Math.max(8, height * 100);
  return (
    <motion.span
      aria-hidden
      initial={reduce ? false : { scaleY: 0 }}
      animate={{ scaleY: 1 }}
      transition={{ duration: 0.7, delay, ease: EASE_OUT }}
      style={{ height: `${pct}%`, transformOrigin: "bottom" }}
      className={`relative w-full max-w-3 rounded-full transition-opacity ${height === 0 ? "opacity-20" : ""} ${className}`}
    />
  );
}

function Figure({
  label,
  value,
  suffix,
  trend,
  trendUnit = "%",
  hint,
}: {
  label: string;
  value: number;
  suffix?: string;
  trend: number | null;
  trendUnit?: string;
  hint: string;
}) {
  const down = trend !== null && trend < 0;
  return (
    <div className="flex flex-col justify-center gap-1 border-border px-6 py-5 sm:border-r sm:last:border-r-0 lg:border-b lg:border-r-0 lg:last:border-b-0">
      <p className="text-sm text-muted">{label}</p>
      <div className="flex items-baseline gap-3">
        <NumberTicker value={value} suffix={suffix} className="font-display text-[2.6rem] leading-none tracking-tight text-foreground" />
        {trend !== null && trend !== 0 && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              down
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {down ? <TrendingDown className="size-3" aria-hidden /> : <TrendingUp className="size-3" aria-hidden />}
            {trend > 0 ? "+" : ""}
            {trend}
            {trendUnit === "%" ? "%" : ` ${trendUnit}`}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

function AwaitingFigure({ analytics }: { analytics: DashboardAnalytics }) {
  const items = analytics.awaitingRecent.slice(0, 2);
  return (
    <div className="flex flex-col justify-center gap-2 px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">Waiting for a report</p>
        <span className="font-display text-2xl leading-none text-foreground tabular-nums">{analytics.awaitingAnalysis}</span>
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Every finished interview has its report
        </p>
      ) : (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.roomId}>
              <Link
                href={`/dashboard/${item.roomId}`}
                className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 text-sm transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="truncate">
                  {item.candidateName ?? "Unnamed candidate"}
                  <span className="text-muted"> for {item.roleTitle ?? "an interview"}</span>
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted transition group-hover:text-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityStripSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-3xl border border-border bg-surface lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" aria-hidden>
      <div className="p-7">
        <div className="skeleton h-4 w-28 rounded" />
        <div className="mt-6 flex h-40 items-end gap-2">
          {Array.from({ length: 14 }, (_, index) => (
            <div key={index} className="skeleton flex-1 rounded-full" style={{ height: `${20 + ((index * 37) % 70)}%` }} />
          ))}
        </div>
      </div>
      <div className="grid gap-px border-t border-border lg:border-l lg:border-t-0">
        {[0, 1, 2].map((index) => (
          <div key={index} className="px-6 py-6">
            <div className="skeleton h-3.5 w-24 rounded" />
            <div className="skeleton mt-3 h-9 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
