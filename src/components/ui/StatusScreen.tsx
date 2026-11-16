import type { ReactNode } from "react";
import Link from "next/link";
import { Check, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";

const TONES = {
  neutral: { tile: "bg-slate-500/10 text-slate-600 dark:text-slate-300", ring: "ring-slate-500/10", glow: "bg-slate-400/15" },
  warn: { tile: "bg-amber-500/10 text-amber-600 dark:text-amber-300", ring: "ring-amber-500/15", glow: "bg-amber-400/20" },
  bad: { tile: "bg-rose-500/10 text-rose-600 dark:text-rose-300", ring: "ring-rose-500/15", glow: "bg-rose-400/20" },
  good: { tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", ring: "ring-emerald-500/15", glow: "bg-emerald-400/25" },
} as const;

export type StatusStep = { label: string; done?: boolean };

/**
 * The one layout for every "this link can't be used" or "you're done" page
 * candidates and visitors meet: logo at the top, then one card with an icon,
 * title, message, an optional "what happens next" path and at most one action.
 */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  message,
  steps,
  action,
  reason,
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  title: string;
  message: ReactNode;
  /** A short path of what happens next; done steps show a tick. */
  steps?: StatusStep[];
  action?: { href: string; label: string; icon?: LucideIcon; reload?: boolean };
  /** Machine-readable reason, for tests and support. */
  reason?: string;
}) {
  const ActionIcon = action?.icon;
  const palette = TONES[tone];
  const actionClass =
    "mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90";

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 py-8" data-reason={reason}>
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px]" />
      <BrandMark href={null} />

      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center py-10">
        <section className="status-enter relative w-full rounded-3xl border border-border bg-surface px-6 pb-8 pt-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_40px_-12px_rgba(15,23,42,0.12)] sm:px-10">
          <div className="relative mx-auto grid size-16 place-items-center">
            <span aria-hidden className={`absolute inset-0 -z-10 rounded-full blur-2xl ${palette.glow}`} />
            <span className={`status-icon grid size-16 place-items-center rounded-2xl ring-8 ${palette.tile} ${palette.ring}`}>
              <Icon className="size-7" aria-hidden />
            </span>
          </div>

          <h1 className="mt-6 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-balance">{title}</h1>
          <p role="status" className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted text-pretty">
            {message}
          </p>

          {steps && steps.length > 0 && (
            <ol className="mt-7 grid gap-0 rounded-2xl border border-border bg-background/60 p-4 text-left text-sm">
              {steps.map((step, index) => {
                const last = index === steps.length - 1;
                return (
                  <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                    {!last && (
                      <span
                        aria-hidden
                        className={`absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px ${step.done ? "bg-emerald-500/40" : "bg-border"}`}
                      />
                    )}
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                        step.done ? "bg-emerald-500 text-white" : "border border-border bg-surface text-muted"
                      }`}
                    >
                      {step.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : index + 1}
                    </span>
                    <span className={`pt-0.5 ${step.done ? "font-medium text-foreground" : "text-muted"}`}>
                      {step.label}
                      <span className="sr-only">{step.done ? " (done)" : " (next)"}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {action &&
            (action.reload ? (
              // A plain link to the same address reloads the page.
              <a href={action.href} className={actionClass}>
                {ActionIcon && <ActionIcon className="size-4" aria-hidden />}
                {action.label}
              </a>
            ) : (
              <Link href={action.href} className={actionClass}>
                {ActionIcon && <ActionIcon className="size-4" aria-hidden />}
                {action.label}
              </Link>
            ))}
        </section>
      </div>
    </main>
  );
}
