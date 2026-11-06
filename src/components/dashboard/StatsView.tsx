"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import type { DashboardStats, StatsRange } from "@/lib/dashboard/stats.types";
import { EASE_OUT, NumberTicker, SegmentedTabs } from "@/components/ui/animated";

const RANGE_TABS: { value: StatsRange; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "all", label: "All time" },
];

const RANGE_PHRASE: Record<StatsRange, string> = {
  "30": "In the last 30 days",
  "90": "In the last 90 days",
  "365": "In the last 12 months",
  all: "Since you started",
};

export function StatsView() {
  const [range, setRange] = useState<StatsRange>("90");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadedRange, setLoadedRange] = useState<StatsRange | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/stats?range=${range}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("stats failed");
        return (await response.json()) as DashboardStats;
      })
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setLoadedRange(range);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range, retry]);

  const loading = loadedRange !== range && !error;

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-10 sm:pt-12">
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-normal tracking-tight sm:text-[2.75rem]">Stats</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {stats ? <Summary stats={stats} /> : "How hiring is going across every role."}
          </p>
        </div>
        <SegmentedTabs id="stats-range" label="Time range" options={RANGE_TABS} value={range} onChange={setRange} />
      </header>

      {error ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <TriangleAlert className="size-5 text-muted" aria-hidden />
          <p className="mt-3 font-medium">The stats didn&apos;t load</p>
          <p className="mt-1 text-sm text-muted">Check your connection, then try again.</p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="mt-5 h-9 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition hover:bg-foreground/[0.03]"
          >
            Try again
          </button>
        </div>
      ) : !stats ? (
        <StatsSkeleton />
      ) : (
        <div className={`grid gap-10 transition-opacity duration-300 ${loading ? "opacity-50" : ""}`}>
          <Funnel stats={stats} key={`funnel-${stats.range}`} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Interviews per week" hint="Sent and finished">
              <WeeklyChart stats={stats} />
            </Panel>
            <Panel title="Score spread" hint={stats.totals.avgScore !== null ? `Average ${stats.totals.avgScore} out of 100` : "No scores yet"}>
              <ScoreSpread stats={stats} />
            </Panel>
          </div>

          <RolesTable stats={stats} />

          <CostSection stats={stats} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Hiring decisions" hint="On interviews that have a report">
              <Decisions stats={stats} />
            </Panel>
            <Panel title="By interview level" hint="How many were run at each level, and how candidates scored">
              <Difficulty stats={stats} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ stats }: { stats: DashboardStats }) {
  const { totals } = stats;
  if (totals.interviews === 0 && totals.applications === 0) return <>{RANGE_PHRASE[stats.range]}, nothing has happened yet.</>;
  return (
    <>
      {RANGE_PHRASE[stats.range]}, {plural(totals.interviews, "interview")} across {plural(totals.roles, "role")}.{" "}
      {totals.completed} finished
      {totals.avgScore !== null ? <>, with an average score of {totals.avgScore}</> : null}
      {totals.minutesInterviewed > 0 ? <>, over {formatMinutes(totals.minutesInterviewed)} of conversation</> : null}.
    </>
  );
}

/* ---------- Funnel: the page's one animated moment ---------- */

function Funnel({ stats }: { stats: DashboardStats }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...stats.funnel.map((step) => step.value));
  return (
    <section aria-label="Hiring funnel" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">From application to decision</h2>
        <p className="text-sm text-muted">Percentages show how many moved on from the step above</p>
      </div>
      <ol className="mt-6 grid gap-3">
        {stats.funnel.map((step, index) => {
          const previous = index > 0 ? stats.funnel[index - 1].value : null;
          const conversion = previous && previous > 0 ? Math.round((step.value / previous) * 100) : null;
          const width = Math.max(step.value === 0 ? 0 : 4, (step.value / max) * 100);
          return (
            <li key={step.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem] items-center gap-4 sm:grid-cols-[9.5rem_minmax(0,1fr)_8rem]">
              <span className="text-sm text-muted">{step.label}</span>
              <div className="relative h-9 overflow-hidden rounded-lg bg-foreground/[0.04]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-lg"
                  style={{
                    background: `linear-gradient(90deg, color-mix(in srgb, var(--accent) ${100 - index * 18}%, var(--gold)), color-mix(in srgb, var(--accent) ${82 - index * 18}%, var(--gold)))`,
                  }}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.9, delay: 0.1 + index * 0.12, ease: EASE_OUT }}
                />
              </div>
              <span className="flex items-baseline justify-end gap-2">
                <NumberTicker value={step.value} className="font-display text-2xl leading-none" />
                <span className="w-12 text-right text-xs text-muted tabular-nums">{conversion !== null ? `${conversion}%` : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {stats.funnel[0].value === 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
          <Info className="size-3.5" aria-hidden />
          Applied counts people who used a role&apos;s application link. Interviews sent directly don&apos;t go through it.
        </p>
      )}
    </section>
  );
}

/* ---------- Panels and charts ---------- */

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-muted">{hint}</p>
      <div className="mt-6 flex-1">{children}</div>
    </section>
  );
}

function WeeklyChart({ stats }: { stats: DashboardStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const weeks = stats.weekly;
  const max = Math.max(1, ...weeks.map((week) => week.interviews));
  const active = hover !== null ? weeks[hover] : null;
  return (
    <div>
      <p className="h-5 text-sm tabular-nums" aria-live="polite">
        {active ? (
          <>
            Week of {formatShort(active.weekStart)}: <strong className="font-medium">{active.interviews}</strong> sent,{" "}
            <strong className="font-medium">{active.completed}</strong> finished
          </>
        ) : (
          <span className="text-muted">Point at a week for its numbers</span>
        )}
      </p>
      <div className="mt-4 flex h-44 items-end gap-1" onPointerLeave={() => setHover(null)} role="img" aria-label="Interviews sent and finished per week">
        {weeks.map((week, index) => (
          <div key={week.weekStart} onPointerEnter={() => setHover(index)} className="relative flex h-full flex-1 items-end">
            <div
              className={`relative w-full overflow-hidden rounded-md transition-opacity ${hover !== null && hover !== index ? "opacity-40" : ""}`}
              style={{ height: `${week.interviews === 0 ? 2 : Math.max(6, (week.interviews / max) * 100)}%` }}
            >
              <div className="absolute inset-0 bg-accent/25" />
              <div
                className="absolute inset-x-0 bottom-0 bg-accent"
                style={{ height: week.interviews ? `${(week.completed / week.interviews) * 100}%` : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{weeks[0] ? formatShort(weeks[0].weekStart) : ""}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent/25" />Sent</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />Finished</span>
        </span>
        <span>This week</span>
      </div>
    </div>
  );
}

const BAND_TONE = ["bg-rose-500", "bg-rose-400", "bg-amber-500", "bg-amber-400", "bg-emerald-500", "bg-emerald-600"];

function ScoreSpread({ stats }: { stats: DashboardStats }) {
  const max = Math.max(1, ...stats.scoreBands.map((band) => band.count));
  return (
    <ul className="grid gap-2.5">
      {stats.scoreBands
        .slice()
        .reverse()
        .map((band, reversedIndex) => {
          const index = stats.scoreBands.length - 1 - reversedIndex;
          return (
            <li key={band.label} className="grid grid-cols-[4rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
              <span className="text-muted tabular-nums">{band.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.05]">
                <span className={`block h-full rounded-full ${BAND_TONE[index]}`} style={{ width: `${(band.count / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{band.count}</span>
            </li>
          );
        })}
    </ul>
  );
}

function RolesTable({ stats }: { stats: DashboardStats }) {
  return (
    <section aria-label="Roles" className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pb-4 pt-6">
        <div>
          <h2 className="text-sm font-medium">Roles</h2>
          <p className="mt-0.5 text-sm text-muted">Where candidates are, role by role</p>
        </div>
        <Link href="/dashboard/roles" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Manage roles
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {stats.roles.length === 0 ? (
        <p className="border-t border-border px-6 py-10 text-center text-sm text-muted">No role activity in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-y border-border bg-foreground/[0.015] text-left text-xs text-muted">
              <tr>
                <th className="px-6 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 text-right font-medium">Applied</th>
                <th className="px-3 py-2.5 text-right font-medium">Interviews</th>
                <th className="px-3 py-2.5 text-right font-medium">Finished</th>
                <th className="px-3 py-2.5 font-medium">Average score</th>
                <th className="px-3 py-2.5 text-right font-medium">Advanced</th>
                <th className="px-6 py-2.5 text-right font-medium">AI cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.roles.map((role) => (
                <tr key={`${role.roleId ?? "t"}-${role.title}`} className="transition-colors hover:bg-foreground/[0.02]">
                  <td className="max-w-[260px] px-6 py-3">
                    {role.roleId ? (
                      <Link href={`/dashboard/roles/${role.roleId}`} className="font-medium hover:underline">
                        {role.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{role.title}</span>
                    )}
                    {!role.roleId && <span className="ml-2 text-xs text-muted">not a saved role</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{role.roleId ? role.applications : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{role.interviews}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{role.completed}</td>
                  <td className="px-3 py-3">
                    {role.avgScore !== null ? (
                      <span className="flex items-center gap-2.5">
                        <span className="w-6 tabular-nums">{role.avgScore}</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/[0.07]">
                          <span
                            className={`block h-full rounded-full ${role.avgScore >= 70 ? "bg-emerald-500" : role.avgScore >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                            style={{ width: `${role.avgScore}%` }}
                          />
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{role.advanced}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatUsd(role.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CostSection({ stats }: { stats: DashboardStats }) {
  const { cost } = stats;
  const voiceShare = cost.totalUsd > 0 ? (cost.voiceUsd / cost.totalUsd) * 100 : 0;
  const monthMax = Math.max(0.01, ...cost.monthly.map((month) => month.voiceUsd + month.assistantUsd));
  return (
    <section aria-label="AI cost" className="grid gap-6 rounded-3xl border border-border bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <h2 className="text-sm font-medium">AI cost</h2>
        <p className="mt-0.5 text-sm text-muted">Estimated from recorded usage at list prices</p>
        <p className="mt-6 font-display text-5xl leading-none tracking-tight">{formatUsd(cost.totalUsd)}</p>
        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-gold/30">
          <div className="h-full rounded-full bg-accent" style={{ width: `${voiceShare}%` }} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-full bg-accent" />Voice interviews</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatUsd(cost.voiceUsd)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-full bg-gold" />Ask AI</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatUsd(cost.assistantUsd)}</dd>
          </div>
          <div>
            <dt className="text-muted">Per interview</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{cost.perInterviewUsd !== null ? formatUsd(cost.perInterviewUsd) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Per hour of interview</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{cost.perHourUsd !== null ? formatUsd(cost.perHourUsd) : "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-col">
        <h3 className="text-sm font-medium">Last 6 months</h3>
        <div className="mt-4 flex flex-1 items-end gap-3" style={{ minHeight: 160 }}>
          {cost.monthly.map((month) => {
            const total = month.voiceUsd + month.assistantUsd;
            return (
              <div key={month.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${formatMonth(month.month)}: ${formatUsd(total)}`}>
                <span className="text-[11px] tabular-nums text-muted">{total > 0 ? formatUsd(total) : ""}</span>
                <div className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-lg" style={{ height: `${total === 0 ? 2 : Math.max(6, (total / monthMax) * 100)}%` }}>
                  <div className="bg-accent" style={{ height: total ? `${(month.voiceUsd / total) * 100}%` : "100%", opacity: total ? 1 : 0.15 }} />
                  <div className="bg-gold" style={{ height: total ? `${(month.assistantUsd / total) * 100}%` : 0 }} />
                </div>
                <span className="text-xs text-muted">{formatMonth(month.month)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-5 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Covers {plural(cost.interviewsWithCost, "interview")} with recorded voice usage, plus Ask AI. Writing reports and
          interview plans isn&apos;t recorded yet, so it isn&apos;t included.
        </p>
      </div>
    </section>
  );
}

function Decisions({ stats }: { stats: DashboardStats }) {
  const parts = [
    { key: "advance", label: "Advance", value: stats.decisions.advance, tone: "bg-emerald-500" },
    { key: "hold", label: "Hold", value: stats.decisions.hold, tone: "bg-amber-500" },
    { key: "reject", label: "Reject", value: stats.decisions.reject, tone: "bg-rose-500" },
    { key: "undecided", label: "No decision yet", value: stats.decisions.undecided, tone: "bg-foreground/15" },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total === 0) return <p className="text-sm text-muted">No reports in this period yet.</p>;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {parts.filter((part) => part.value > 0).map((part) => (
          <div key={part.key} className={part.tone} style={{ width: `${(part.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 text-sm">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.03] px-3 py-2">
            <span className="flex items-center gap-2 text-muted"><span className={`size-2 rounded-full ${part.tone}`} />{part.label}</span>
            <span className="font-medium tabular-nums">{part.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEVEL_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", "extra-hard": "Extra hard" };

function Difficulty({ stats }: { stats: DashboardStats }) {
  if (stats.difficulty.length === 0) return <p className="text-sm text-muted">No interviews in this period yet.</p>;
  const max = Math.max(1, ...stats.difficulty.map((level) => level.count));
  return (
    <ul className="grid gap-3">
      {stats.difficulty.map((level) => (
        <li key={level.level} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span>{LEVEL_LABEL[level.level] ?? level.level}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.05]">
            <span className="block h-full rounded-full bg-ink/70 dark:bg-ink/60" style={{ width: `${(level.count / max) * 100}%` }} />
          </span>
          <span className="w-36 text-right text-muted tabular-nums">
            {plural(level.count, "interview")}
            {level.avgScore !== null ? `, avg ${level.avgScore}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden>
      <div className="skeleton h-80 rounded-3xl" />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="skeleton h-72 rounded-2xl" />
        <div className="skeleton h-72 rounded-2xl" />
      </div>
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}

/* ---------- formatting ---------- */

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : plural(hours, "hour");
}

function formatUsd(value: number): string {
  return value < 10 ? `$${value.toFixed(2)}` : `$${Math.round(value).toLocaleString()}`;
}

function formatShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
}
