"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ACTIVITY_GROUPS, activityGroup } from "@/lib/auth/accounts.logic";

interface Entry {
  id: number;
  at: string;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  ip: string | null;
}

interface Person {
  id: string;
  name: string;
}

const selectClass =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10";

const GROUP_TONE: Record<string, string> = {
  auth: "bg-foreground/[0.06] text-muted",
  team: "bg-accent/10 text-accent",
  role: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  application: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  interview: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  decision: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  report: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  settings: "bg-foreground/[0.06] text-foreground",
  export: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** Where an entry points, when it points at something that still has a page. */
function targetHref(entry: Entry): string | null {
  if (!entry.targetId || entry.targetId.includes(",")) return null;
  if (entry.targetType === "interview" && !entry.action.endsWith("deleted")) return `/dashboard/${entry.targetId}`;
  if (entry.targetType === "role" && !entry.action.endsWith("deleted")) return `/dashboard/roles/${entry.targetId}`;
  if (entry.targetType === "application" && typeof entry.details?.roleId === "string") return `/dashboard/roles/${entry.details.roleId}`;
  return null;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Everything people did, newest first, with filters by person and kind. */
export function ActivityLog({ people }: { people: Person[] }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [person, setPerson] = useState("");
  const [group, setGroup] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const query = useCallback(
    (before: number | null) => {
      const params = new URLSearchParams();
      if (person) params.set("person", person);
      if (group) params.set("group", group);
      if (before) params.set("before", String(before));
      return fetch(`/api/activity?${params.toString()}`)
        .then((response) => (response.ok ? (response.json() as Promise<{ entries: Entry[]; next: number | null }>) : null))
        .catch(() => null);
    },
    [person, group],
  );

  // First page for the current filters.
  useEffect(() => {
    let cancelled = false;
    query(null).then((data) => {
      if (cancelled) return;
      if (!data) {
        setState("error");
        return;
      }
      setEntries(data.entries);
      setNext(data.next);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function loadOlder(before: number) {
    const data = await query(before);
    if (!data) {
      setState("error");
      return;
    }
    setEntries((current) => [...current, ...data.entries]);
    setNext(data.next);
  }

  // The same thing done several times in a row (sign-ins, mostly) is one line with a count.
  const rows: { entry: Entry; day: string; showDay: boolean; count: number }[] = [];
  for (const entry of entries) {
    const day = dayLabel(entry.at);
    const last = rows.at(-1);
    if (last && last.day === day && last.entry.actorName === entry.actorName && last.entry.summary === entry.summary && !targetHref(entry)) {
      last.count += 1;
      continue;
    }
    rows.push({ entry, day, showDay: !last || last.day !== day, count: 1 });
  }
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <label className="sr-only" htmlFor="activity-person">Person</label>
        <select id="activity-person" className={selectClass} value={person} onChange={(e) => { setState("loading"); setPerson(e.target.value); }}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-group">Kind</label>
        <select id="activity-group" className={selectClass} value={group} onChange={(e) => { setState("loading"); setGroup(e.target.value); }}>
          <option value="">All activity</option>
          {Object.entries(ACTIVITY_GROUPS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {state === "error" && <p className="px-5 py-8 text-center text-sm text-red-600 dark:text-red-400">The activity could not be loaded. Refresh to try again.</p>}
      {state === "loading" && <p className="px-5 py-8 text-center text-sm text-muted">Loading activity…</p>}
      {state === "ready" && entries.length === 0 && (
        <p className="px-5 py-8 text-center text-sm text-muted">Nothing recorded for this filter yet.</p>
      )}

      {entries.length > 0 && (
        <ol className="px-5 pb-2">
          {rows.map(({ entry, day, showDay, count }) => {
            const g = activityGroup(entry.action);
            const href = targetHref(entry);
            return (
              <li key={entry.id}>
                {showDay && <p className="pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-muted">{day}</p>}
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border py-3 sm:grid-cols-[4.5rem_10rem_minmax(0,1fr)_4rem]">
                  <time
                    dateTime={entry.at}
                    title={entry.ip && entry.ip !== "unknown" ? `From ${entry.ip}` : undefined}
                    className="text-sm tabular-nums text-muted"
                  >
                    {new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </time>
                  <p className="min-w-0 truncate text-sm font-medium" title={entry.actorEmail ?? undefined}>{entry.actorName}</p>
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="text-sm">
                      <span className={`mr-2 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${GROUP_TONE[g] ?? GROUP_TONE.settings}`}>
                        {ACTIVITY_GROUPS[g] ?? "Other"}
                      </span>
                      {entry.summary}
                      {count > 1 && <span className="ml-1.5 text-xs font-medium tabular-nums text-muted">× {count}</span>}
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center gap-3 text-xs text-muted sm:col-span-1 sm:justify-end">
                    {href && (
                      <Link href={href} className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
                        Open <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {next && (
        <div className="border-t border-border px-5 py-3 text-center">
          <button type="button" onClick={() => void loadOlder(next)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10">
            Show older
          </button>
        </div>
      )}
    </section>
  );
}
