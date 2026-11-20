"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Sparkles, UserCheck } from "lucide-react";

/** One interview this person scheduled, flattened for the browser. */
export interface MemberInterview {
  id: string;
  candidateName: string | null;
  candidateEmail: string | null;
  roleTitle: string | null;
  scheduledAt: string | null;
  status: string;
}

/** A batch of candidates this person moved to "Selected" on a role. */
export interface MemberSelection {
  roleId: string;
  roleTitle: string | null;
  count: number;
  /** Who was in the batch: candidate emails, as the decision recorded them. */
  candidates: string[];
  at: string;
}

/** A role this person created. */
export interface MemberRole {
  id: string;
  title: string | null;
  at: string;
}

type TabKey = "scheduled" | "completed" | "selected" | "roles";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  waiting: "Waiting to join",
  active: "In progress",
  completed: "Completed",
  expired: "Expired",
};

function formatMoment(value: string | null): string {
  if (!value) return "Any time";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "expired") return "bg-foreground/[0.06] text-muted";
  return "bg-accent/10 text-accent";
}

/**
 * A person's work, split by what it is: interviews waiting to happen,
 * interviews finished, candidates they marked Selected, and roles they
 * created. Each card is a button that shows that list underneath.
 */
export function MemberWorkTabs({
  memberName,
  interviews,
  selections,
  roles,
}: {
  memberName: string;
  interviews: MemberInterview[];
  selections: MemberSelection[];
  roles: MemberRole[];
}) {
  const scheduled = interviews.filter((room) => room.status === "scheduled");
  const completed = interviews.filter((room) => room.status === "completed");
  const selectedCount = selections.reduce((total, item) => total + item.count, 0);

  const tabs: Array<{ key: TabKey; label: string; value: number; icon: React.ReactNode }> = [
    { key: "scheduled", label: "Scheduled", value: scheduled.length, icon: <CalendarClock className="size-3.5" aria-hidden /> },
    { key: "completed", label: "Completed", value: completed.length, icon: <CheckCircle2 className="size-3.5" aria-hidden /> },
    { key: "selected", label: "Selected", value: selectedCount, icon: <UserCheck className="size-3.5" aria-hidden /> },
    { key: "roles", label: "Roles created", value: roles.length, icon: <Sparkles className="size-3.5" aria-hidden /> },
  ];

  const [active, setActive] = useState<TabKey>("scheduled");
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <div className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(tab.key)}
              className={`rounded-2xl border px-4 py-3.5 text-left transition ${
                on
                  ? "border-accent bg-accent/[0.06] ring-4 ring-accent/10"
                  : "border-border bg-surface hover:border-accent/40"
              }`}
            >
              <p
                className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider ${
                  on ? "text-accent" : "text-muted"
                }`}
              >
                {tab.icon}
                {tab.label}
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">{tab.value}</p>
            </button>
          );
        })}
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <h2 className="font-semibold tracking-tight">
            {active === "scheduled" && "Interviews scheduled"}
            {active === "completed" && "Completed interviews"}
            {active === "selected" && "Candidates marked Selected"}
            {active === "roles" && "Roles created"}
          </h2>
          <span className="text-sm tabular-nums text-muted">{current.value} total</span>
        </div>

        {active === "scheduled" || active === "completed" ? (
          <InterviewTable
            rooms={active === "scheduled" ? scheduled : completed}
            memberName={memberName}
            empty={
              active === "scheduled"
                ? `No interviews waiting for ${memberName}.`
                : `${memberName} has not completed an interview yet.`
            }
          />
        ) : null}

        {active === "selected" ? (
          selections.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              {memberName} has not marked anyone Selected yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {selections.map((item) => (
                <li key={`${item.roleId}-${item.at}`} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {item.count} candidate{item.count === 1 ? "" : "s"} marked Selected
                    </p>
                    <p className="truncate text-xs text-muted">
                      {item.roleTitle ?? "A role that no longer exists"} · {formatMoment(item.at)}
                    </p>
                    {item.candidates.length > 0 && (
                      <p className="truncate text-xs text-muted">{item.candidates.join(", ")}</p>
                    )}
                  </div>
                  <Link
                    href={`/dashboard/roles/${item.roleId}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Open role
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {active === "roles" ? (
          roles.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">{memberName} has not created a role yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {roles.map((role) => (
                <li key={role.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{role.title ?? "A role that no longer exists"}</p>
                    <p className="text-xs text-muted">Created {formatMoment(role.at)}</p>
                  </div>
                  <Link
                    href={`/dashboard/roles/${role.id}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Open role
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}

function InterviewTable({
  rooms,
  memberName,
  empty,
}: {
  rooms: MemberInterview[];
  memberName: string;
  empty: string;
}) {
  if (rooms.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
            <th className="px-5 py-2.5 font-medium">Candidate</th>
            <th className="px-3 py-2.5 font-medium">Role</th>
            <th className="px-3 py-2.5 font-medium">Scheduled</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-5 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rooms.map((room) => (
            <tr key={room.id} className="align-middle">
              <td className="px-5 py-3">
                <p className="font-medium">{room.candidateName ?? "Unnamed candidate"}</p>
                <p className="truncate text-xs text-muted">{room.candidateEmail ?? "No email"}</p>
              </td>
              <td className="px-3 py-3 text-muted">{room.roleTitle ?? "-"}</td>
              <td className="px-3 py-3 text-muted">
                <span className="tabular-nums">{formatMoment(room.scheduledAt)}</span>
              </td>
              <td className="px-3 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(room.status)}`}>
                  {STATUS_LABEL[room.status] ?? room.status}
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                <Link href={`/dashboard/${room.id}`} className="text-sm font-medium text-accent hover:underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only">Interviews scheduled by {memberName}.</p>
    </div>
  );
}
