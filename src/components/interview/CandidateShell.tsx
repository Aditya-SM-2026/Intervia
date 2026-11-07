import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The backdrop for every screen a candidate sees around the interview: the
 * same deep navy and light from above as the home page, with the brand at the
 * top. The live call itself uses the same colours, so joining feels like one
 * continuous place.
 */
export function CandidateShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#08123a] text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_50%_at_50%_0%,rgba(74,114,245,0.45),transparent_70%)]"
      />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <BrandMark href={null} onDark />
        {right}
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-10 sm:px-8">{children}</div>
    </main>
  );
}

/** A centred message on the candidate backdrop: an icon, a title, a line and actions. */
export function CandidateMessage({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <CandidateShell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {icon}
        <h1 className="mt-6 max-w-lg text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {children && <div className="mt-3 max-w-md text-white/70">{children}</div>}
        {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    </CandidateShell>
  );
}

export const candidatePrimaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#08123a] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60";
export const candidateGhostButton =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10";
