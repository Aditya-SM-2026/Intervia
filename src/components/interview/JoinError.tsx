import { Clock, Link2Off, MailX, RotateCcw, ServerCrash, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";

interface JoinErrorProps {
  code: "ROOM_NOT_FOUND" | "ROOM_EXPIRED" | "ROOM_UNAVAILABLE" | "EMAIL_MISMATCH" | "SERVER_ERROR";
  message: string;
}

const VIEWS: Record<JoinErrorProps["code"], { title: string; icon: LucideIcon; tint: string; retry?: boolean }> = {
  ROOM_NOT_FOUND: { title: "This link doesn't work", icon: Link2Off, tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  ROOM_EXPIRED: { title: "This interview link has expired", icon: Clock, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  ROOM_UNAVAILABLE: { title: "This interview isn't available", icon: Link2Off, tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300", retry: true },
  EMAIL_MISMATCH: { title: "This link is for someone else", icon: MailX, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  SERVER_ERROR: { title: "We couldn't load your interview", icon: ServerCrash, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-300", retry: true },
};

/** Shown to a candidate whose interview link cannot be opened. */
export function JoinError({ code, message }: JoinErrorProps) {
  const view = VIEWS[code];
  const Icon = view.icon;
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-8" data-reason={code}>
      <BrandMark href={null} />
      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <span className={`grid size-14 place-items-center rounded-2xl ${view.tint}`}>
          <Icon className="size-6" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{view.title}</h1>
        <p role="alert" className="mt-2 text-muted">
          {message}
        </p>
        {view.retry && (
          // A plain link to the same address reloads the page.
          <a
            href=""
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </a>
        )}
      </div>
    </main>
  );
}
