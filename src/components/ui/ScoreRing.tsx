"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/components/ui/animated";

/**
 * A score out of 100 drawn as a ring. The ring fills once on mount; the
 * number in the middle is the real score. Colour follows the score band
 * unless a stroke class is passed.
 */
export function ScoreRing({
  score,
  size = 56,
  stroke = 5,
  label,
  className,
  toneClass,
  delay = 0,
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  /** Small caption under the number, inside the ring. */
  label?: string;
  className?: string;
  /** Tailwind stroke class, e.g. "stroke-emerald-500". */
  toneClass?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = score === null ? 0 : Math.max(0, Math.min(100, score));
  const tone =
    toneClass ??
    (score === null ? "stroke-transparent" : value >= 70 ? "stroke-emerald-500" : value >= 50 ? "stroke-amber-500" : "stroke-rose-500");
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? "No score yet" : `${score} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-foreground/[0.07]" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={tone}
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - value / 100) }}
          transition={{ duration: 0.9, delay, ease: EASE_OUT }}
        />
      </svg>
      <span aria-hidden className="absolute inset-0 grid place-content-center text-center leading-none">
        <span className="font-semibold tabular-nums tracking-[-0.02em]" style={{ fontSize: Math.round(size * 0.3) }}>
          {score ?? "—"}
        </span>
        {label && <span className="mt-0.5 text-[10px] text-muted">{label}</span>}
      </span>
    </span>
  );
}
