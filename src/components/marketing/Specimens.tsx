"use client";

import { Check, Mic, Pause, X } from "lucide-react";
import { ScoreRing } from "@/components/ui/ScoreRing";

/**
 * Small, static pictures of the product for the landing page. They show the
 * real shapes a recruiter meets in the app (report, focus weights, decision)
 * with sample data, so the page explains itself without paragraphs.
 */

const WAVE = [3, 6, 10, 15, 9, 13, 18, 12, 7, 14, 9, 5, 11, 6, 3, 8, 12, 6];

export function Waveform({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {WAVE.map((height, index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${index < 9 ? "bg-accent" : "bg-candidate"}`}
          style={{ height: `${height * 1.6}px` }}
        />
      ))}
    </span>
  );
}

const FACTORS = [
  { label: "Skills", score: 84 },
  { label: "Problem solving", score: 79 },
  { label: "Communication", score: 72 },
  { label: "Resume match", score: 88 },
];

/** The hero picture: the top of a candidate report. */
export function ReportSpecimen() {
  return (
    <figure className="relative">
      <div className="absolute -left-4 -top-5 z-10 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2.5 shadow-lg shadow-black/5 sm:-left-8">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-candidate/60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-candidate" />
        </span>
        <span className="text-xs font-medium">Interview in progress</span>
        <Waveform />
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-[0_30px_70px_-35px_rgba(16,24,40,0.4)] sm:p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-violet-500/10 text-sm font-semibold text-violet-700 dark:text-violet-300">
            PR
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Priya Raman</p>
            <p className="text-sm text-muted">AI Developer</p>
          </div>
          <span className="ml-auto rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            Hire
          </span>
        </div>

        <div className="mt-6 flex items-center gap-6">
          <ScoreRing score={82} size={104} stroke={9} label="of 100" />
          <ul className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
            {FACTORS.map((factor, index) => (
              <li key={factor.label} className="flex items-center gap-2.5">
                <ScoreRing score={factor.score} size={38} stroke={4} delay={0.15 + index * 0.08} />
                <span className="text-xs leading-tight text-muted">{factor.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <p className="rounded-xl bg-emerald-500/[0.07] px-3.5 py-2.5 text-sm">
            <span className="block text-xs font-semibold text-emerald-700 dark:text-emerald-300">Strength</span>
            Shipped a RAG system to production
          </p>
          <p className="rounded-xl bg-amber-500/[0.08] px-3.5 py-2.5 text-sm">
            <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">Ask next round</span>
            How they evaluate model drift
          </p>
        </div>

        <blockquote className="mt-4 border-l-2 border-candidate pl-3 text-sm text-muted">
          “We only switched once the mismatch rate had been zero for five days.”
        </blockquote>
      </div>
    </figure>
  );
}

const FOCUS = [
  { skill: "Python", level: 5 },
  { skill: "LLM systems", level: 4 },
  { skill: "SQL", level: 3 },
];

/** Step 1: the role and the skills to weigh. */
export function FocusSpecimen() {
  return (
    <ul className="grid gap-2">
      {FOCUS.map((row) => (
        <li key={row.skill} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
          <span className="flex-1 text-sm font-medium">{row.skill}</span>
          <span className="flex items-end gap-[3px]" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((step) => (
              <span
                key={step}
                className={`w-1.5 rounded-full ${step <= row.level ? "bg-accent" : "bg-foreground/10"}`}
                style={{ height: 5 + step * 3 }}
              />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Step 2: the spoken interview. */
export function ConversationSpecimen() {
  return (
    <div className="grid gap-2">
      <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm">
        <Mic className="mt-0.5 size-3.5 shrink-0 text-accent" />
        How did you test the retrieval step?
      </p>
      <p className="ml-6 rounded-xl bg-candidate/10 px-3.5 py-2.5 text-sm">
        We built a set of 200 real questions and tracked recall on every change.
      </p>
      <Waveform className="ml-1 mt-1" />
    </div>
  );
}

/** Step 3: the decision. */
export function DecisionSpecimen() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-3.5">
      <ScoreRing score={82} size={56} stroke={5} />
      <div className="grid flex-1 grid-cols-3 gap-1.5 text-xs font-medium">
        <span className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-white">
          <Check className="size-3.5" /> Advance
        </span>
        <span className="flex items-center justify-center gap-1 rounded-lg border border-border py-2 text-muted">
          <Pause className="size-3.5" /> Hold
        </span>
        <span className="flex items-center justify-center gap-1 rounded-lg border border-border py-2 text-muted">
          <X className="size-3.5" /> Reject
        </span>
      </div>
    </div>
  );
}
