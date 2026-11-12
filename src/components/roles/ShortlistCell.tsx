"use client";

import { useState } from "react";
import type { RoleCandidateSummary } from "@/lib/roles/role.types";
import { SHORTLIST_LABELS } from "@/lib/roles/shortlist";

/**
 * The Shortlist cell: a chip showing where the candidate stands, and a click to
 * override it by hand. Cycling is deliberate and reversible:
 *
 *   no decision (cutoff decides) -> Shortlisted -> Not shortlisted -> no decision
 *
 * A manual decision always wins over the role's cutoff, in both directions, so
 * HR can lift someone the cutoff dropped or hold back someone it passed.
 */
export function ShortlistCell({
  roleId,
  candidate,
  onChange,
}: {
  roleId: string;
  candidate: RoleCandidateSummary;
  onChange: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = candidate.shortlistStatus ?? "not_scored";
  const manual = candidate.shortlisted ?? null;

  if (!candidate.applicationId) {
    return <span className="text-xs text-muted">No application</span>;
  }

  const next: boolean | null = manual === null ? true : manual ? false : null;

  async function apply() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${roleId}/shortlist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: candidate.applicationId, shortlisted: next }),
      });
      if (!response.ok) throw new Error("Could not save the shortlist decision.");
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the shortlist decision.");
    } finally {
      setSaving(false);
    }
  }

  const tone =
    status === "shortlisted"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "below_cutoff"
        ? "bg-foreground/[0.05] text-muted"
        : "bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void apply()}
        disabled={saving}
        title={
          manual === null
            ? "The role's cutoff decides. Click to shortlist this candidate by hand."
            : manual
              ? "Shortlisted by hand. Click to mark not shortlisted."
              : "Marked not shortlisted by hand. Click to clear and let the cutoff decide."
        }
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${tone}`}
      >
        {SHORTLIST_LABELS[status]}
        {manual !== null && (
          <span aria-hidden className="text-[10px] opacity-70">
            {manual ? "manual" : "held"}
          </span>
        )}
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
