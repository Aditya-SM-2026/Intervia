"use client";

import { InfoTip } from "@/components/ui/InfoTip";

import { useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Save, Sparkles } from "lucide-react";
import {
  DEFAULT_CONDUCT,
  DEFAULT_PERSONA,
  DEFAULT_STYLES,
  DIFFICULTIES,
  type AgentDifficulty,
  type AgentPersonality,
} from "@/lib/agent/personality.types";

const STYLE_LABELS: Record<AgentDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  "extra-hard": "Extra hard",
};

const TEXT_FIELDS = [
  {
    key: "persona" as const,
    label: "Persona",
    hint: "How the interviewer speaks: tone, warmth, length of replies, handling of pauses and interruptions.",
    rows: 8,
    placeholder: DEFAULT_PERSONA,
  },
  {
    key: "conduct" as const,
    label: "Conduct",
    hint: "How it runs the interview: topics, follow-ups, what it must never say, how it ends.",
    rows: 14,
    placeholder: DEFAULT_CONDUCT,
  },
];

/** One textarea per part of the instructions, plus a reset to the built-ins. */
export function AgentBehaviourForm({ initial }: { initial: AgentPersonality }) {
  const [persona, setPersona] = useState(initial.persona);
  const [conduct, setConduct] = useState(initial.conduct);
  const [styles, setStyles] = useState<Record<AgentDifficulty, string>>({
    easy: initial.styles.easy ?? "",
    medium: initial.styles.medium ?? "",
    hard: initial.styles.hard ?? "",
    "extra-hard": initial.styles["extra-hard"] ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const values: Record<"persona" | "conduct", string> = { persona, conduct };
  const setValue = (key: "persona" | "conduct", value: string) => {
    if (key === "persona") setPersona(value);
    else setConduct(value);
    setSaved(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // The voice is managed on its own page; this save leaves it untouched.
        body: JSON.stringify({ persona, conduct, styles }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not save the behaviour.");
      }
      setSaved("Saved. Every interview from now on uses this behaviour.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function restoreDefaults() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      // Clearing the text through PUT keeps the chosen voice intact. DELETE
      // would reset the whole row, including the voice.
      const response = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: "", conduct: "", styles: {} }),
      });
      if (!response.ok) throw new Error("Could not restore the basic personality.");
      setPersona("");
      setConduct("");
      setStyles({ easy: "", medium: "", hard: "", "extra-hard": "" });
      setSaved("Back to the basic personality. Any field left empty uses the built-in text.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">Agent behaviour<InfoTip text="These are the interviewer's instructions. Every box is optional: an empty box keeps the built-in text shown in grey, and a box you write in is marked Custom. A change applies to every interview from now on, including ones already scheduled." /></h2>
          </div>
          {/* The time zone differs between server and browser; the browser's wins. */}
          <span suppressHydrationWarning className="rounded-full border border-border px-3 py-1 text-xs text-muted">
            {initial.updatedAt
              ? `Saved ${new Date(initial.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "Basic personality"}
          </span>
        </div>
      </div>

      {TEXT_FIELDS.map((field) => (
        <section key={field.key} className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold tracking-tight">
              {field.label}
              <InfoTip text={field.hint} />
              {values[field.key].trim() && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">Custom</span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setValue(field.key, field.placeholder)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Load the built-in text
            </button>
          </div>
          <textarea
            value={values[field.key]}
            onChange={(event) => setValue(field.key, event.target.value)}
            rows={field.rows}
            placeholder={field.placeholder}
            spellCheck={false}
            className="mt-3 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 font-mono text-[13px] leading-relaxed outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">Interviewer style by difficulty<InfoTip text="The interview's difficulty picks one of these. Leave a box empty to keep the built-in style for that level, shown in grey." /></h3>
        <div className="mt-4 grid gap-4">
          {DIFFICULTIES.map((difficulty) => (
            <div key={difficulty}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={`style-${difficulty}`}>
                  {STYLE_LABELS[difficulty]}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStyles((current) => ({
                      ...current,
                      [difficulty]: DEFAULT_STYLES[difficulty],
                    }));
                    setSaved(null);
                  }}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Load the built-in text
                </button>
              </div>
              <textarea
                id={`style-${difficulty}`}
                value={styles[difficulty]}
                onChange={(event) => {
                  const value = event.target.value;
                  setStyles((current) => ({ ...current, [difficulty]: value }));
                  setSaved(null);
                }}
                rows={3}
                placeholder={DEFAULT_STYLES[difficulty]}
                spellCheck={false}
                className="mt-2 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 font-mono text-[13px] leading-relaxed outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? (
            <Sparkles className="size-4 animate-pulse" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {saving ? "Saving…" : "Save behaviour"}
        </button>
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-background disabled:opacity-60"
        >
          <RotateCcw className="size-4" aria-hidden />
          Restore basic personality
        </button>
        <Link
          href="/dashboard/settings"
          className="ml-auto text-sm font-medium text-muted transition hover:text-foreground"
        >
          Back to settings
        </Link>
      </div>

      {saved && (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" aria-hidden />
          {saved}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
