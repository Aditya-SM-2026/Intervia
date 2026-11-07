"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Mic } from "lucide-react";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { EASE_OUT } from "@/components/ui/animated";

/**
 * A short looping "film" of the product: the interviewer asks, the candidate
 * answers, the report scores. Drawn in code so it stays sharp and light, and
 * shown as a still of the final scene when reduced motion is on.
 */

const ACTS = [
  { label: "The interviewer asks", ms: 4200 },
  { label: "The candidate answers", ms: 4800 },
  { label: "You get the report", ms: 5200 },
];

const QUESTION = "Walk me through how you tested the retrieval step.";
const ANSWER = "We built 200 real questions from support tickets and tracked recall on every change.";

function Words({ text, className, step = 0.06 }: { text: string; className?: string; step?: number }) {
  return (
    <p className={className}>
      {text.split(" ").map((word, index) => (
        <motion.span
          key={index}
          className="inline-block"
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.35 + index * step, duration: 0.35, ease: EASE_OUT }}
        >
          {word}&nbsp;
        </motion.span>
      ))}
    </p>
  );
}

function LiveWave({ tone }: { tone: "accent" | "candidate" }) {
  const reduce = useReducedMotion();
  return (
    <span className="flex h-8 items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: 22 }, (_, index) => (
        <motion.span
          key={index}
          className={`w-[3px] rounded-full ${tone === "accent" ? "bg-[#8fa8ff]" : "bg-[#6fd3a8]"}`}
          initial={{ height: 4 }}
          animate={reduce ? { height: 10 } : { height: [4, 8 + ((index * 7) % 22), 5, 12 + ((index * 5) % 14), 4] }}
          transition={{ duration: 1.1 + (index % 4) * 0.15, repeat: Infinity, ease: "easeInOut", delay: index * 0.03 }}
        />
      ))}
    </span>
  );
}

function AskScene() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="relative grid place-items-center">
        <motion.span
          className="absolute size-28 rounded-full bg-[#4a72f5]/25"
          animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.15, 0.6] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="relative grid size-16 place-items-center rounded-full bg-gradient-to-br from-[#6d8dff] to-[#2446d8] shadow-[0_0_40px_rgba(74,114,245,0.6)]">
          <Mic className="size-6 text-white" />
        </span>
      </div>
      <Words text={QUESTION} className="max-w-md text-xl font-medium leading-snug text-white sm:text-2xl" />
      <LiveWave tone="accent" />
    </div>
  );
}

function AnswerScene() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <p className="max-w-sm rounded-2xl bg-white/[0.06] px-4 py-2.5 text-sm text-white/55">{QUESTION}</p>
      <div className="flex max-w-md items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#6fd3a8]/20 text-xs font-semibold text-[#6fd3a8]">
          PR
        </span>
        <Words
          text={ANSWER}
          step={0.05}
          className="rounded-2xl rounded-tl-sm bg-[#6fd3a8]/[0.12] px-4 py-3 text-lg leading-snug text-white"
        />
      </div>
      <LiveWave tone="candidate" />
    </div>
  );
}

const FACTORS = [
  { label: "Skills", value: 84 },
  { label: "Problem solving", value: 79 },
  { label: "Communication", value: 72 },
];

function ReportScene() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-2xl bg-white p-5 text-slate-900 shadow-2xl sm:flex-row sm:items-center sm:p-6">
        <div className="flex items-center gap-4 sm:flex-col sm:gap-2">
          <ScoreRing score={82} size={104} stroke={9} label="of 100" delay={0.2} />
          <motion.span
            className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1, duration: 0.3 }}
          >
            Hire
          </motion.span>
        </div>
        <div className="flex-1">
          <p className="font-semibold">Priya Raman</p>
          <p className="text-sm text-slate-500">AI Developer</p>
          <ul className="mt-3 grid gap-2">
            {FACTORS.map((factor, index) => (
              <li key={factor.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs text-slate-500">
                {factor.label}
                <span className="font-semibold tabular-nums text-slate-900">{factor.value}</span>
                <span className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.span
                    className="block h-full rounded-full bg-emerald-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${factor.value}%` }}
                    transition={{ delay: 0.4 + index * 0.15, duration: 0.8, ease: EASE_OUT }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <motion.span
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.6, duration: 0.35 }}
          >
            <Check className="size-3.5" /> Advance
          </motion.span>
        </div>
      </div>
    </div>
  );
}

const SCENES = [AskScene, AnswerScene, ReportScene];

export function HeroFilm({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  const [act, setAct] = useState(reduce ? 2 : 0);

  useEffect(() => {
    if (reduce) return;
    const timer = setTimeout(() => setAct((current) => (current + 1) % ACTS.length), ACTS[act].ms);
    return () => clearTimeout(timer);
  }, [act, reduce]);

  const Scene = SCENES[act];

  return (
    <figure
      className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0d1a4a]/70 shadow-[0_40px_120px_-40px_rgba(36,70,216,0.7)] backdrop-blur"
      aria-label="A short animation: the interviewer asks a question, the candidate answers, and the report shows a score of 82."
    >
      <div className="flex items-center justify-between px-5 pt-4 text-xs text-white/60">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.8)]" />
          AI Developer interview
        </span>
        <span className="tabular-nums">{act === 2 ? "Report ready" : act === 0 ? "04:12" : "04:31"}</span>
      </div>

      <div className={`relative px-5 ${compact ? "h-[300px]" : "h-[340px] sm:h-[380px]"}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={act}
            className="absolute inset-0 px-5"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
          >
            <Scene />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* The player bar: three chapters, the current one filling. */}
      <div className="grid grid-cols-3 gap-3 px-5 pb-5">
        {ACTS.map((chapter, index) => (
          <button
            key={chapter.label}
            type="button"
            onClick={() => setAct(index)}
            className="group text-left"
            aria-label={`Show: ${chapter.label}`}
          >
            <span className="block h-1 overflow-hidden rounded-full bg-white/15">
              <motion.span
                key={`${index}-${act}`}
                className="block h-full rounded-full bg-white"
                initial={{ width: index < act ? "100%" : "0%" }}
                animate={{ width: index < act ? "100%" : index === act ? "100%" : "0%" }}
                transition={index === act && !reduce ? { duration: chapter.ms / 1000, ease: "linear" } : { duration: 0 }}
              />
            </span>
            <span
              className={`mt-2 block truncate text-xs transition ${index === act ? "text-white" : "text-white/45 group-hover:text-white/70"}`}
            >
              {chapter.label}
            </span>
          </button>
        ))}
      </div>
    </figure>
  );
}
