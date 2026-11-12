"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Funnel, Trash2, X } from "lucide-react";
import type { RoleCandidateSummary } from "@/lib/roles/role.types";
import type { InterviewState } from "@/lib/roles/candidate-status";
import {
  clampThreshold,
  fallsBelowThresholds,
  hasThresholds,
  meetsThresholds,
  type MatchThresholds,
} from "@/lib/roles/match-thresholds";

/** Interviews that a new invitation would duplicate or interrupt. */
const ALREADY_BOOKED: ReadonlySet<InterviewState> = new Set<InterviewState>([
  "scheduled",
  "link-opened",
  "in-progress",
  "completed",
  "evaluated",
]);

function canReceiveInvite(candidate: RoleCandidateSummary): boolean {
  return !ALREADY_BOOKED.has(candidate.interviewState);
}

function interviewNote(candidate: RoleCandidateSummary): string | null {
  if (candidate.interviewState === "completed" || candidate.interviewState === "evaluated") {
    return "Interview completed";
  }
  if (
    candidate.interviewState === "scheduled" ||
    candidate.interviewState === "link-opened" ||
    candidate.interviewState === "in-progress"
  ) {
    return "Already scheduled";
  }
  return null;
}

/**
 * The role's one candidate filter, with both jobs attached to it.
 *
 * HR types a minimum Match and a minimum CGPA once. From the same two numbers
 * the panel shows everyone who clears the bar (ready for an invitation) and
 * everyone whose known numbers fall short (ready to be removed). Nothing is
 * scheduled or deleted without a second click.
 */
export function CandidateFilterDialog({
  candidates,
  thresholds,
  onThresholdsChange,
  onClose,
  onSchedule,
  onDelete,
}: {
  candidates: RoleCandidateSummary[];
  thresholds: MatchThresholds;
  onThresholdsChange: (next: MatchThresholds) => void;
  onClose: () => void;
  onSchedule: (candidateIds: string[]) => void;
  onDelete: (candidateIds: string[]) => void;
}) {
  const [tab, setTab] = useState<"matching" | "below">("matching");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [matchText, setMatchText] = useState(
    thresholds.minMatch === null ? "" : String(thresholds.minMatch),
  );
  const [cgpaText, setCgpaText] = useState(
    thresholds.minCgpa === null ? "" : String(thresholds.minCgpa),
  );

  const matching = useMemo(
    () =>
      candidates
        .filter((candidate) => meetsThresholds(candidate, thresholds))
        .sort(
          (a, b) =>
            (b.screeningScore ?? 0) - (a.screeningScore ?? 0) ||
            (a.candidateName ?? a.candidateEmail).localeCompare(b.candidateName ?? b.candidateEmail),
        ),
    [candidates, thresholds],
  );

  const below = useMemo(
    () =>
      candidates
        .filter((candidate) => fallsBelowThresholds(candidate, thresholds))
        .sort(
          (a, b) =>
            (a.screeningScore ?? 0) - (b.screeningScore ?? 0) ||
            (a.candidateName ?? a.candidateEmail).localeCompare(b.candidateName ?? b.candidateEmail),
        ),
    [candidates, thresholds],
  );

  const activeRows = tab === "matching" ? matching : below;
  const selectableRows = activeRows.filter(
    (candidate) => tab === "below" || canReceiveInvite(candidate),
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((candidate) => selected.has(candidate.candidateId));

  const readyIds = new Set(
    matching
      .filter((candidate) => canReceiveInvite(candidate))
      .map((candidate) => candidate.candidateId),
  );
  const readySelected = [...selected].filter((id) => readyIds.has(id));

  const active = hasThresholds(thresholds);

  function commitMatch(value: string) {
    setMatchText(value);
    const parsed = Number(value);
    onThresholdsChange({
      ...thresholds,
      minMatch: value.trim() === "" || !Number.isFinite(parsed) ? null : clampThreshold(parsed, 100),
    });
  }

  function commitCgpa(value: string) {
    setCgpaText(value);
    const parsed = Number(value);
    onThresholdsChange({
      ...thresholds,
      minCgpa:
        value.trim() === "" || !Number.isFinite(parsed)
          ? null
          : Math.round(clampThreshold(parsed, 100) * 10) / 10,
    });
  }

  function toggle(candidateId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Filter candidates by Match and CGPA"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Funnel className="size-4 text-accent" aria-hidden />
              Filter candidates
            </h2>
            <p className="mt-0.5 max-w-xl text-sm text-muted">
              Set the bar once. Schedule the candidates who clear it, or remove the ones who do
              not.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="border-b border-border bg-foreground/[0.015] px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Minimum Match</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={matchText}
                  onChange={(event) => commitMatch(event.target.value)}
                  onBlur={() =>
                    setMatchText(thresholds.minMatch === null ? "" : String(thresholds.minMatch))
                  }
                  placeholder="e.g. 60"
                  aria-label="Minimum Match score"
                  className="h-9 w-24 rounded-lg border border-border bg-surface px-2.5 text-sm tabular-nums outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <span className="text-xs text-muted">/ 100</span>
              </div>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Minimum CGPA</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={cgpaText}
                  onChange={(event) => commitCgpa(event.target.value)}
                  onBlur={() =>
                    setCgpaText(thresholds.minCgpa === null ? "" : String(thresholds.minCgpa))
                  }
                  placeholder="e.g. 7"
                  aria-label="Minimum CGPA"
                  className="h-9 w-24 rounded-lg border border-border bg-surface px-2.5 text-sm tabular-nums outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <span className="text-xs text-muted">or %</span>
              </div>
            </label>
            <p className="max-w-xs pb-1.5 text-xs leading-5 text-muted">
              Leave a box empty to ignore that half. A candidate with no Match or CGPA is never
              counted.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border px-5 pt-3">
          {(
            [
              { id: "matching" as const, label: "Matching", count: matching.length },
              { id: "below" as const, label: "Below the bar", count: below.length },
            ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-pressed={tab === item.id}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === item.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="rounded-md bg-foreground/[0.06] px-1.5 text-xs font-semibold tabular-nums">
                {item.count}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!active ? (
            <div className="px-5 py-12 text-center">
              <p className="font-medium">Enter a minimum Match or CGPA</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                The role page list follows the bar as you type. Once it is set, you can schedule
                everyone above it in one go, or clear out everyone below it.
              </p>
            </div>
          ) : activeRows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-medium">
                {tab === "matching" ? "Nobody clears the bar yet" : "Nobody falls below the bar"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                {tab === "matching"
                  ? "Lower the Match or CGPA bar, or wait for more candidates to apply."
                  : "Candidates with no Match score or CGPA are never treated as below, so they stay here untouched."}
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-foreground/[0.015] text-xs text-muted">
                  <th scope="col" className="w-10 py-2.5 pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Select every ${tab === "matching" ? "matching" : "below-bar"} candidate`}
                      checked={allSelected}
                      disabled={selectableRows.length === 0}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(selectableRows.map((row) => row.candidateId)),
                        )
                      }
                      className="size-4 cursor-pointer accent-[var(--accent)] disabled:opacity-30"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Candidate</th>
                  <th scope="col" className="px-3 py-2.5 font-medium tabular-nums">Match</th>
                  <th scope="col" className="px-3 py-2.5 font-medium tabular-nums">CGPA</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Interview</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => {
                  const blocked = tab === "matching" && !canReceiveInvite(row);
                  const isSelected = selected.has(row.candidateId);
                  const note = interviewNote(row);
                  return (
                    <tr
                      key={row.candidateId}
                      className={`border-b border-border/60 last:border-0 ${
                        isSelected ? "bg-accent-soft/50" : ""
                      }`}
                    >
                      <td className="py-3 pl-5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.candidateName ?? row.candidateEmail}`}
                          checked={isSelected}
                          disabled={blocked}
                          onChange={() => toggle(row.candidateId)}
                          className="size-4 cursor-pointer accent-[var(--accent)] disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{row.candidateName ?? "Unnamed candidate"}</p>
                        <p className="text-xs text-muted">{row.candidateEmail}</p>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {row.screeningScore ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {row.candidateCgpa ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {note ? (
                          <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted">
                            {note}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">Ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <p className="text-sm text-muted tabular-nums">
            {selected.size} selected
            {tab === "matching" && matching.length > readyIds.size && (
              <span className="ml-1 text-xs">
                · {matching.length - readyIds.size} already booked
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDelete([...selected])}
              disabled={selected.size === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-300 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-40 dark:border-rose-500/30 dark:text-rose-400"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete{selected.size > 0 ? ` ${selected.size}` : ""}
            </button>
            <button
              type="button"
              onClick={() => onSchedule(readySelected)}
              disabled={readySelected.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
            >
              <CalendarPlus className="size-4" aria-hidden />
              Schedule{readySelected.length > 0 ? ` ${readySelected.length}` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
