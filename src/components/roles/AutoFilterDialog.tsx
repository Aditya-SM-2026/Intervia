"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import type { RoleCandidateSummary } from "@/lib/roles/role.types";
import {
  isAutoFiltered,
  type AutoFilterRule,
} from "@/lib/roles/auto-filter";

/**
 * The automatic resume filter, with HR holding both the limits and the delete
 * button.
 *
 * The rule is "Match below X and CGPA below Y", and X and Y belong to the role:
 * HR edits them here and they are saved for next time. Candidates arrive
 * unticked; select all is one click, but nothing is removed until the
 * recruiter confirms. A delete takes the candidate's interviews and
 * application for this role only.
 */
export function AutoFilterDialog({
  roleId,
  candidates,
  rule,
  onRuleSaved,
  onClose,
  onDeleted,
}: {
  roleId: string;
  candidates: RoleCandidateSummary[];
  rule: AutoFilterRule;
  onRuleSaved: (rule: AutoFilterRule) => void;
  onClose: () => void;
  onDeleted: (removed: number) => void;
}) {
  const [matchBelow, setMatchBelow] = useState(String(rule.matchBelow));
  const [cgpaBelow, setCgpaBelow] = useState(String(rule.cgpaBelow));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: AutoFilterRule = {
    matchBelow: Number(matchBelow) || 0,
    cgpaBelow: Number(cgpaBelow) || 0,
  };

  const rows = useMemo(
    () =>
      candidates
        .filter((candidate) => isAutoFiltered(candidate, draft))
        .sort(
          (a, b) =>
            (a.screeningScore ?? 0) - (b.screeningScore ?? 0) ||
            (a.candidateName ?? a.candidateEmail).localeCompare(
              b.candidateName ?? b.candidateEmail,
            ),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, matchBelow, cgpaBelow],
  );

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.candidateId));
  const changed =
    Number(matchBelow) !== rule.matchBelow || Number(cgpaBelow) !== rule.cgpaBelow;

  function toggle(candidateId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
    setConfirming(false);
  }

  async function saveRule() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/auto-filter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as {
        rule?: AutoFilterRule;
        error?: { message?: string };
      };
      if (!response.ok || !body.rule) {
        throw new Error(body.error?.message ?? "Could not save the filter rule.");
      }
      setMatchBelow(String(body.rule.matchBelow));
      setCgpaBelow(String(body.rule.cgpaBelow));
      onRuleSaved(body.rule);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the filter rule.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (running || selected.size === 0) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/candidates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [...selected] }),
      });
      const body = (await response.json()) as {
        requested?: number;
        error?: { message?: string };
      };
      if (!response.ok || typeof body.requested !== "number") {
        throw new Error(body.error?.message ?? "Could not remove the candidates.");
      }
      onDeleted(body.requested);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the candidates.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Automatic filtration"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Automatic filtration</h2>
            <p className="mt-0.5 text-sm text-muted">
              {rows.length} candidate{rows.length === 1 ? "" : "s"} match this role&apos;s rule
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-foreground/[0.015] px-5 py-3">
          <label className="inline-flex items-center gap-1.5 text-sm">
            Match below
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={matchBelow}
              onChange={(event) => {
                setMatchBelow(event.target.value);
                setConfirming(false);
              }}
              aria-label="Match score limit"
              className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            CGPA below
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={cgpaBelow}
              onChange={(event) => {
                setCgpaBelow(event.target.value);
                setConfirming(false);
              }}
              aria-label="CGPA limit"
              className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveRule()}
            disabled={!changed || saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-foreground/[0.05] disabled:opacity-40"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save rule
          </button>
          <span className="text-xs text-muted">Saved for this role, used next time.</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-medium">Nobody matches the rule right now</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              A candidate is listed only when their Match score is below the Match limit and their
              CGPA is below the CGPA limit. A missing CGPA never qualifies, so freshers stay in the
              list.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-foreground/[0.015] text-xs text-muted">
                  <th scope="col" className="w-10 py-2.5 pl-5">
                    <input
                      type="checkbox"
                      aria-label="Select every filtered candidate"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected ? new Set() : new Set(rows.map((row) => row.candidateId)),
                        )
                      }
                      className="size-4 cursor-pointer accent-[var(--accent)]"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Candidate</th>
                  <th scope="col" className="px-3 py-2.5 font-medium tabular-nums">Match</th>
                  <th scope="col" className="px-3 py-2.5 font-medium tabular-nums">CGPA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.candidateId} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pl-5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.candidateName ?? row.candidateEmail}`}
                        checked={selected.has(row.candidateId)}
                        onChange={() => toggle(row.candidateId)}
                        className="size-4 cursor-pointer accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{row.candidateName ?? "Unnamed candidate"}</p>
                      <p className="text-xs text-muted">{row.candidateEmail}</p>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-rose-600 dark:text-rose-400">
                      {row.screeningScore ?? "—"}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.candidateCgpa ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p role="alert" className="border-t border-border px-5 py-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <p className="text-sm text-muted tabular-nums">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={selected.size === 0 || running || rows.length === 0}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white transition disabled:opacity-40 ${
                confirming ? "bg-rose-700 hover:bg-rose-800" : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : confirming ? (
                <AlertTriangle className="size-3.5" aria-hidden />
              ) : (
                <Trash2 className="size-3.5" aria-hidden />
              )}
              {confirming
                ? `Delete ${selected.size} for good`
                : `Delete ${selected.size || ""} candidate${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>

        {confirming && (
          <p className="border-t border-border bg-rose-500/[0.06] px-5 py-3 text-xs leading-5 text-rose-700 dark:text-rose-300">
            This removes their interviews, reports and applications for this role. It cannot be
            undone.
          </p>
        )}
      </div>
    </div>
  );
}
