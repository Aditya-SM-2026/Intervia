"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_HINTS,
  RESUME_SECTION_IDS,
  RESUME_SECTION_LABELS,
  type ScreeningWeights,
} from "@/lib/screening/types";
import { Toast, type ToastMessage } from "@/components/ui/Toast";

/** The six sections in display order, with the wording the editor shows. */
const SECTIONS = RESUME_SECTION_IDS.map((id) => ({
  id,
  label: RESUME_SECTION_LABELS[id],
  hint: RESUME_SECTION_HINTS[id],
}));

/**
 * The role's resume-screening setting: the six section weights, and the button
 * that scores applications collected before screening was switched on.
 *
 * Weights are advice only: they change how the stored section scores add up,
 * never whether someone is rejected, and saving them costs nothing because no
 * model call is made. Every section that was not found on a resume is left out
 * of the maths rather than scored zero, so a fresher is not marked down for
 * having no certifications.
 */

interface Preset {
  id: string;
  label: string;
  hint: string;
  weights: ScreeningWeights;
}

const PRESETS: Preset[] = [
  { id: "default", label: "Balanced", hint: "The starting point", weights: DEFAULT_SCREENING_WEIGHTS },
  {
    id: "experienced",
    label: "Experienced hires",
    hint: "Leans on work history and projects",
    weights: { summary: 10, skills: 20, experience: 40, projects: 25, certifications: 5 },
  },
  {
    id: "freshers",
    label: "Freshers",
    hint: "Leans on projects, coursework and skills",
    weights: { summary: 10, skills: 30, experience: 10, projects: 45, certifications: 5 },
  },
];

function total(weights: ScreeningWeights): number {
  return SECTIONS.reduce((sum, section) => sum + (weights[section.id] ?? 0), 0);
}

export function ScreeningSettings({ roleId }: { roleId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [weights, setWeights] = useState<ScreeningWeights>({ ...DEFAULT_SCREENING_WEIGHTS });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [cutoff, setCutoff] = useState(0);
  const [cutoffSaved, setCutoffSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const url = `/api/roles/${encodeURIComponent(roleId)}/screening`;

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (response) => {
        const body = (await response.json()) as
          | { enabled: boolean; weights: ScreeningWeights }
          | { error?: { message?: string } };
        if (!response.ok || !("weights" in body)) {
          throw new Error(("error" in body && body.error?.message) || "Could not load the screening settings.");
        }
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setEnabled(body.enabled);
        setWeights({ ...DEFAULT_SCREENING_WEIGHTS, ...body.weights });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load the screening settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/roles/${encodeURIComponent(roleId)}/shortlist`)
      .then(async (response) => {
        const body = (await response.json()) as { cutoff?: number; error?: { message?: string } };
        if (!response.ok || typeof body.cutoff !== "number") return;
        if (cancelled) return;
        setCutoff(body.cutoff);
        setCutoffSaved(body.cutoff);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  async function saveCutoff() {
    setSaving(true);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/shortlist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoff }),
      });
      const body = (await response.json()) as { cutoff?: number; error?: { message?: string } };
      if (!response.ok || typeof body.cutoff !== "number") {
        throw new Error(body.error?.message ?? "Could not save the shortlist cutoff.");
      }
      setCutoff(body.cutoff);
      setCutoffSaved(body.cutoff);
      setError(null);
      setToast({
        tone: "success",
        message:
          body.cutoff === 0
            ? "Cutoff cleared: nothing is shortlisted automatically."
            : `Shortlisted at ${body.cutoff} and above.`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the shortlist cutoff.");
    } finally {
      setSaving(false);
    }
  }

  async function save(patch: { enabled?: boolean; weights?: ScreeningWeights }) {
    setSaving(true);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json()) as
        | { enabled: boolean; weights: ScreeningWeights }
        | { error?: { message?: string } };
      if (!response.ok || !("weights" in body)) {
        throw new Error(("error" in body && body.error?.message) || "Could not save the screening settings.");
      }
      setEnabled(body.enabled);
      setWeights({ ...DEFAULT_SCREENING_WEIGHTS, ...body.weights });
      setError(null);
      setToast({ tone: "success", message: "Screening settings saved." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the screening settings.");
    } finally {
      setSaving(false);
    }
  }

  async function scorePending() {
    setRunning(true);
    try {
      const base = `/api/roles/${encodeURIComponent(roleId)}/screening/backfill`;
      const estimateResponse = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateOnly: true }),
      });
      const estimate = (await estimateResponse.json()) as {
        pending?: number;
        withText?: number;
        estimatedUsd?: number;
        error?: { message?: string };
      };
      if (!estimateResponse.ok) throw new Error(estimate.error?.message ?? "Could not count the pending applications.");
      if (!estimate.withText) {
        setToast({ tone: "success", message: "Every application has already been screened." });
        return;
      }
      const runResponse = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 }),
      });
      const run = (await runResponse.json()) as {
        screened?: number;
        failed?: number;
        pending?: number;
        error?: { message?: string };
      };
      if (!runResponse.ok) throw new Error(run.error?.message ?? "Could not score the applications.");
      setToast({
        tone: "success",
        message: `Scored ${run.screened ?? 0} application${run.screened === 1 ? "" : "s"}${
          run.pending ? `, ${run.pending} still to go` : ""
        }.`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not score the applications.");
    } finally {
      setRunning(false);
    }
  }

  const sum = total(weights);

  return (
    <section
      aria-label="Resume screening"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.02]"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3.5 lg:shrink-0">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${
              enabled ? "bg-accent-soft text-accent" : "bg-foreground/[0.06] text-muted"
            }`}
          >
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Resume screening</h2>
            {loading ? (
              <div className="skeleton mt-1.5 h-3.5 w-40 rounded" />
            ) : (
              <p className="mt-0.5 text-sm text-muted">
                <span className={enabled ? "font-medium text-accent" : "font-medium"}>
                  {enabled ? "Scoring new applications" : "Off"}
                </span>{" "}
                · advice only, nobody is rejected automatically
              </p>
            )}
          </div>
        </div>

        <span className="hidden grow lg:block" />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void scorePending()}
            disabled={running || loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-foreground/[0.03] disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
            Score Generator
          </button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            Weights
            <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-4 rounded-xl bg-rose-500/[0.07] px-3.5 py-2 text-sm text-rose-700 sm:mx-5 dark:text-rose-300">
          {error}
        </p>
      )}

      {open && (
        <div className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => {
              const active = SECTIONS.every((section) => weights[section.id] === preset.weights[section.id]);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  onClick={() => setWeights({ ...preset.weights })}
                  className={`h-8 rounded-lg px-3 text-xs font-medium transition ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "border border-border text-muted hover:bg-foreground/[0.03] hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            <span className="grow" />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  void save({ enabled: event.target.checked });
                }}
                className="size-4 cursor-pointer accent-[var(--accent)]"
              />
              Screen new applications
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map((section) => (
              <label key={section.id} className="rounded-xl border border-border px-3 py-2.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{section.label}</span>
                  <span className="flex items-center gap-1 text-sm">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={weights[section.id]}
                      onChange={(event) =>
                        setWeights((current) => ({
                          ...current,
                          [section.id]: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                        }))
                      }
                      className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                    />
                    <span className="text-muted">%</span>
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">{section.hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
            <span className="text-sm font-medium">Shortlist at a Match score of</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={cutoff}
              onChange={(event) => setCutoff(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
              aria-label="Shortlist cutoff"
              className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            <span className="text-sm text-muted">or above · 0 turns it off</span>
            <span className="grow" />
            <button
              type="button"
              onClick={() => void saveCutoff()}
              disabled={saving || cutoff === cutoffSaved}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-foreground/[0.03] disabled:opacity-40"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save cutoff
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            The cutoff only decides what the Shortlist column shows. A manual tick on a candidate always wins, and
            nobody is ever rejected automatically.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`text-sm tabular-nums ${sum === 100 ? "text-muted" : "font-medium text-rose-600 dark:text-rose-400"}`}>
              {sum === 100 ? "Weights add up to 100%" : `Weights add up to ${sum}%, they need to total 100%`}
            </span>
            <span className="grow" />
            <button
              type="button"
              onClick={() => void save({ weights })}
              disabled={saving || sum !== 100}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save weights
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            A section that is not on the resume is left out and its weight is shared by the rest, so nobody is marked
            down for having no certifications. Changing a weight re-adds the stored scores instantly and costs nothing.
          </p>
        </div>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
