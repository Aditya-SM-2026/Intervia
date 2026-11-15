import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";

const TONES = {
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  bad: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
} as const;

/**
 * The one layout for every "this link can't be used" or "you're done" page
 * candidates and visitors meet: logo at the top, then a centred icon, title,
 * message and at most one action.
 */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  message,
  action,
  reason,
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  title: string;
  message: ReactNode;
  action?: { href: string; label: string; icon?: LucideIcon; reload?: boolean };
  /** Machine-readable reason, for tests and support. */
  reason?: string;
}) {
  const ActionIcon = action?.icon;
  const actionClass =
    "mt-7 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90";
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-8" data-reason={reason}>
      <BrandMark href={null} />
      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <span className={`grid size-14 place-items-center rounded-2xl ${TONES[tone]}`}>
          <Icon className="size-6" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p role="status" className="mt-2 text-muted">
          {message}
        </p>
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
      </div>
    </main>
  );
}
