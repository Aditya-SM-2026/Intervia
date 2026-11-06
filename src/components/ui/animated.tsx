"use client";

import { animate, motion, useInView, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shared easing for the product: quick out, soft landing. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts content into place; respects reduced-motion settings. */
export function FadeIn({
  delay = 0,
  y = 10,
  className,
  children,
  ...rest
}: { delay?: number; y?: number; children: ReactNode } & HTMLMotionProps<"div">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.55, delay, ease: EASE_OUT }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Counts up to `value` once it scrolls into view. */
export function NumberTicker({
  value,
  suffix = "",
  className,
  duration = 1.1,
}: {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    // Animation frames pause in background tabs; land on the real figure
    // regardless, so a number is never left half-counted.
    const settle = setTimeout(() => setDisplay(value), duration * 1000 + 150);
    return () => {
      controls.stop();
      clearTimeout(settle);
    };
  }, [inView, value, reduce, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {reduce ? value : display}
      {suffix}
    </span>
  );
}

/** Pill tabs with a sliding indicator. */
export function SegmentedTabs<T extends string>({
  id,
  options,
  value,
  onChange,
  label,
}: {
  id: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex items-center gap-0.5 rounded-xl bg-foreground/[0.05] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-border"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.label}
              {option.count !== undefined && (
                <span className={`rounded-md px-1.5 text-[11px] tabular-nums ${active ? "bg-accent-soft text-accent" : "bg-foreground/[0.06]"}`}>
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
