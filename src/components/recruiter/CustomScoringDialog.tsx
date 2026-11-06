"use client";

import { useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import {
  DEFAULT_SKILL_WEIGHT,
  MAX_SKILL_FOCUS,
  MAX_SKILL_NAME_LENGTH,
  normalizeSkillFocus,
  type SkillFocus,
} from "@/lib/interviews/skill-focus";

interface CustomScoringDialogProps {
  /** The role the interview is for, used in the heading. */
  roleTitle: string;
  /** Skills already on the role; these start as the parameters. */
  roleSkills: string[];
  /** The current setting, empty when custom scoring has not been used. */
  focus: SkillFocus[];
  onSave: (focus: SkillFocus[]) => void;
  onClose: () => void;
}

function labelForWeight(weight: number): string {
  if (weight === 0) return "Skip";
  if (weight < DEFAULT_SKILL_WEIGHT) return "Light";
  if (weight === DEFAULT_SKILL_WEIGHT) return "Normal";
  if (weight < 80) return "More";
  return "Heavy";
}

/**
 * The custom scoring box. Every parameter gets a 0-100 weight that tells the
 * interviewer how much of the interview to spend on it. This only shapes the
 * questions; it is not a pass mark and it never limits the topics.
 */
export function CustomScoringDialog({
  roleTitle,
  roleSkills,
  focus,
  onSave,
  onClose,
}: CustomScoringDialogProps) {
  const [rows, setRows] = useState<SkillFocus[]>(() =>
    focus.length > 0
      ? focus.map((item) => ({ ...item }))
      : roleSkills.map((skill) => ({ skill, weight: DEFAULT_SKILL_WEIGHT })),
  );
  const [newSkill, setNewSkill] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function setWeight(index: number, weight: number) {
    setRows((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, weight } : item,
      ),
    );
  }

  function remove(index: number) {
    setRows((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function addParameter() {
    const skill = newSkill.trim();
    if (!skill) return;
    if (rows.some((item) => item.skill.toLowerCase() === skill.toLowerCase())) {
      setError(`${skill} is already in the list.`);
      return;
    }
    if (rows.length >= MAX_SKILL_FOCUS) {
      setError(`Use at most ${MAX_SKILL_FOCUS} parameters.`);
      return;
    }
    setError(null);
    setRows((current) => [...current, { skill, weight: DEFAULT_SKILL_WEIGHT }]);
    setNewSkill("");
  }

  function save() {
    const cleaned = normalizeSkillFocus(rows);
    if (cleaned.length === 0) {
      onSave([]);
      return;
    }
    onSave(cleaned);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-scoring-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id="custom-scoring-title" className="text-lg font-semibold">
              Skill weighting
            </h2>
            <p className="mt-1 text-sm text-muted">
              How much of the interview should go to each skill for{" "}
              <span className="font-medium text-foreground">{roleTitle || "this role"}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close custom scoring"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <p className="text-sm leading-6 text-muted">
            Heavier skills get more questions and follow-ups. Nothing is left out, and leaving everything at
            normal lets the job description decide.
          </p>

          {dragging !== null && (
            <p className="mt-2 text-xs text-muted" aria-live="polite">
              {dragging}/100
            </p>
          )}

          <div className="mt-4 divide-y divide-border border-y border-border">
            {rows.length === 0 && (
              <p className="py-5 text-sm text-muted">
                No parameters yet. Add a skill such as AWS, Kubernetes or English communication.
              </p>
            )}
            {rows.map((item, index) => (
              <div key={`${item.skill}-${index}`} className="py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`focus-${index}`} className="min-w-0 truncate text-sm font-medium">
                    {item.skill}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">
                      <span className="font-medium">{labelForWeight(item.weight)}</span>
                      <span className="ml-1.5 text-muted">{item.weight}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${item.skill}`}
                      className="grid size-6 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <input
                  id={`focus-${index}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={item.weight}
                  onChange={(event) => setWeight(index, Number(event.target.value))}
                  onPointerDown={() => setDragging(item.weight)}
                  onPointerUp={() => setDragging(null)}
                  aria-valuetext={`${item.skill}: ${item.weight} out of 100, ${labelForWeight(item.weight)}`}
                  className="mt-2 w-full accent-[var(--accent)]"
                />
                <div className="mt-0.5 flex justify-between text-[11px] text-muted">
                  <span>Skip</span>
                  <span>Normal</span>
                  <span>Heavy</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="new-parameter" className="mb-1.5 block text-sm font-medium">
              Add a skill
            </label>
            <div className="flex gap-2">
              <input
                id="new-parameter"
                type="text"
                maxLength={MAX_SKILL_NAME_LENGTH}
                value={newSkill}
                placeholder="e.g. Kubernetes, AI, English communication"
                onChange={(event) => setNewSkill(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addParameter();
                  }
                }}
                className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <button
                type="button"
                onClick={addParameter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition hover:border-accent hover:text-accent"
              >
                <Plus className="size-4" aria-hidden />
                Add
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setRows((current) => current.map((item) => ({ ...item, weight: DEFAULT_SKILL_WEIGHT })))}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-foreground"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Reset all to normal
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg px-3.5 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
            >
              Use these weights
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
