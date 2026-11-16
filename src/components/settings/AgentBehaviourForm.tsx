"use client";

import { InfoTip } from "@/components/ui/InfoTip";

import { useState } from "react";
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

  const [level, setLevel] = useState<AgentDifficulty>("medium");
  const savedAt = initial.updatedAt
    ? `Saved ${new Date(initial.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "Built-in personality";
  const textArea =
    "mt-3 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none transition placeholder:text-foreground/55 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15";

  return (
    <div className="grid gap-5">
      {TEXT_FIELDS.map((field) => (
        <section key={field.key} className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold tracking-tight">
              {field.label}
              <InfoTip text={field.hint} />
              <SourceChip custom={values[field.key].trim().length > 0} />
            </h3>
            <FieldAction
              custom={values[field.key].trim().length > 0}
              onEdit={() => setValue(field.key, field.placeholder)}
              onReset={() => setValue(field.key, "")}
            />
          </div>
          <textarea
            value={values[field.key]}
            onChange={(event) => setValue(field.key, event.target.value)}
            rows={field.rows}
            placeholder={field.placeholder}
            spellCheck={false}
            aria-label={field.label}
            className={textArea}
          />
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            Style by difficulty
            <InfoTip text="The interview's difficulty picks one of these. Leave a box empty to keep the built-in style for that level." />
          </h3>
          <div role="tablist" aria-label="Difficulty" className="inline-flex rounded-lg bg-foreground/[0.05] p-0.5">
            {DIFFICULTIES.map((difficulty) => (
              <button
                key={difficulty}
                type="button"
                role="tab"
                aria-selected={level === difficulty}
                onClick={() => setLevel(difficulty)}
                className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  level === difficulty ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"
                }`}
              >
                {STYLE_LABELS[difficulty]}
                {styles[difficulty].trim() && <span aria-label="custom" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <SourceChip custom={styles[level].trim().length > 0} />
          <FieldAction
            custom={styles[level].trim().length > 0}
            onEdit={() => {
              setStyles((current) => ({ ...current, [level]: DEFAULT_STYLES[level] }));
              setSaved(null);
            }}
            onReset={() => {
              setStyles((current) => ({ ...current, [level]: "" }));
              setSaved(null);
            }}
          />
        </div>
        <textarea
          id={`style-${level}`}
          aria-label={`${STYLE_LABELS[level]} style`}
          value={styles[level]}
          onChange={(event) => {
            const value = event.target.value;
            setStyles((current) => ({ ...current, [level]: value }));
            setSaved(null);
          }}
          rows={4}
          placeholder={DEFAULT_STYLES[level]}
          spellCheck={false}
          className={textArea.replace("mt-3", "mt-2")}
        />
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Always in reach on a long page. */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur">
        {saved ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{saved}</span>
          </span>
        ) : (
          <span suppressHydrationWarning className="text-sm text-muted">{savedAt}</span>
        )}
        <span className="grow" />
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-60"
        >
          <RotateCcw className="size-4" aria-hidden />
          Restore built-in
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-60"
        >
          {saving ? <Sparkles className="size-4 animate-pulse" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Whether a box holds your own text or shows the built-in one. */
function SourceChip({ custom }: { custom: boolean }) {
  return custom ? (
    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">Custom</span>
  ) : (
    <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted">Built-in</span>
  );
}

/** Built-in text: copy it into the box to change it. Your own text: go back to the built-in. */
function FieldAction({ custom, onEdit, onReset }: { custom: boolean; onEdit: () => void; onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={custom ? onReset : onEdit}
      className="text-xs font-medium text-accent hover:underline"
    >
      {custom ? "Use the built-in text" : "Edit the built-in text"}
    </button>
  );
}
