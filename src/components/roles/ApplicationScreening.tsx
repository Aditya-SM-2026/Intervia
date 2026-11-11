"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { sanitizeWeights, screeningTotal } from "@/lib/screening/score";
import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_LABELS,
  type ScreeningSnapshot,
  type ScreeningWeights,
} from "@/lib/screening/types";

/**
 * One application's resume screening inside the review sheet: the total, the
 * "scored on N of M sections" line, each section with its evidence, and the
 * free keyword chips.
 *
 * The total is recomputed here from the stored section scores and the role's
 * current weights, so a weight saved five minutes ago shows up without paying
 * for the resume to be read again.
 */

const STATUS_TEXT: Record<string, string> = {
  not_found: "Not on the resume",
  insufficient_evidence: "Nothing usable found",
};

export function ApplicationScreening({
  roleId,
  applicationId,
}: {
  roleId: string;
  applicationId: string;
}) {
  const [snapshot, setSnapshot] = useState<ScreeningSnapshot | null>(null);
  const [weights, setWeights] = useState<ScreeningWeights>({ ...DEFAULT_SCREENING_WEIGHTS });
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/roles/${encodeURIComponent(roleId)}`;

  const load = useCallback(() => {
    fetch(`${base}/applications/${encodeURIComponent(applicationId)}/screening`)
      .then(async (response) => {
        const body = (await response.json()) as {
          screening?: ScreeningSnapshot | null;
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? "Could not load the screening.");
        setSnapshot(body.screening ?? null);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not load the screening.");
      })
      .finally(() => setLoading(false));
  }, [base, applicationId]);

  useEffect(() => {
    load();
    let cancelled = false;
    fetch(`${base}/screening`)
      .then(async (response) => {
        const body = (await response.json()) as { weights?: ScreeningWeights };
        if (!cancelled && body.weights) setWeights(sanitizeWeights(body.weights));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [load, base]);

  async function scoreAgain() {
    setRerunning(true);
    try {
      const response = await fetch(`${base}/applications/${encodeURIComponent(applicationId)}/screening`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        screening?: ScreeningSnapshot;
        error?: { message?: string };
      };
      if (!response.ok || !body.screening) {
        throw new Error(body.error?.message ?? "Could not score this resume.");
      }
      setSnapshot(body.screening);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not score this resume.");
    } finally {
      setRerunning(false);
    }
  }

  const totals = snapshot ? screeningTotal(snapshot.sections, weights) : null;
  const shownScore = totals?.score === null || totals?.score === undefined ? null : Math.round(totals.score);

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" aria-hidden />
          Resume screening
        </h3>
        <button
          type="button"
          onClick={() => void scoreAgain()}
          disabled={rerunning}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition hover:bg-foreground/[0.03] disabled:opacity-50"
        >
          {rerunning ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          Score again
        </button>
      </div>

      {loading ? (
        <div className="skeleton mt-4 h-16 rounded-xl" />
      ) : error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : !snapshot ? (
        <p className="mt-2 text-sm text-muted">Not screened yet.</p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums">{shownScore ?? "—"}</span>
            <span className="text-sm text-muted">
              {snapshot.status === "scored" && totals
                ? totals.weightedSections > 0
                  ? `scored on ${totals.scoredSections} of ${totals.weightedSections} sections`
                  : "no sections weighted"
                : snapshot.status === "failed"
                  ? "could not be scored"
                  : "not scored"}
            </span>
          </div>

          {snapshot.reason && <p className="mt-1 text-xs text-muted">{snapshot.reason}</p>}
          {snapshot.summary && <p className="mt-3 text-[15px] leading-6">{snapshot.summary}</p>}

          {snapshot.keywords.matched.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted">Skills found on the resume</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {snapshot.keywords.matched.map((skill) => (
                  <span key={skill} className="rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          {snapshot.keywords.missing.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted">Not found by name (an abbreviation may still match)</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {snapshot.keywords.missing.map((skill) => (
                  <span key={skill} className="rounded-lg bg-foreground/[0.05] px-2 py-1 text-xs text-muted">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ul className="mt-4 grid gap-2.5">
            {snapshot.status !== "scored" ? null : snapshot.sections.map((section) => (
              <li key={section.id} className="rounded-xl border border-border px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{RESUME_SECTION_LABELS[section.id]}</span>
                  <span className="text-sm tabular-nums">
                    {section.score === null ? (
                      <span className="text-xs text-muted">{STATUS_TEXT[section.status] ?? "—"}</span>
                    ) : (
                      <>
                        {section.score}
                        <span className="ml-1 text-xs text-muted">/100</span>
                      </>
                    )}
                  </span>
                </div>
                {section.rationale && <p className="mt-1 text-sm text-muted">{section.rationale}</p>}
                {section.evidence.length > 0 && (
                  <ul className="mt-1.5 grid gap-1">
                    {section.evidence.map((item) => (
                      <li key={item.quote} className="border-l-2 border-accent/30 pl-2 text-xs italic text-muted">
                        {item.quote}
                      </li>
                    ))}
                  </ul>
                )}
                {section.note && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{section.note}</p>}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted">
            Advice only: nobody is rejected by this score. It moves when the role&apos;s weights move, and a section that
            is not on the resume is left out rather than scored zero.
          </p>
        </>
      )}
    </div>
  );
}
