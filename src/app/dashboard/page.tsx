import type { Metadata } from "next";
import { Suspense } from "react";
import { TopNav } from "@/components/dashboard/TopNav";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { ThemeProvider } from "@/components/dashboard/theme";

export const metadata: Metadata = {
  title: "Interview reports",
};

/**
 * Post-interview reports page: top navigation, analytics header and the
 * reports workspace. The decorative header accent is pure CSS — no fake
 * imagery, no sidebar.
 */
export default function DashboardPage() {
  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <div className="relative overflow-hidden py-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-80 w-[480px] rounded-full bg-gradient-to-bl from-accent/25 via-accent/10 to-transparent blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-24 top-6 hidden rotate-6 rounded-2xl border border-accent/20 bg-surface/60 p-4 shadow-lg shadow-accent/10 sm:block"
          >
            <div className="grid gap-2">
              <div className="h-2 w-28 rounded-full bg-accent/60" />
              <div className="h-2 w-36 rounded-full bg-accent/25" />
              <div className="h-2 w-24 rounded-full bg-accent/25" />
            </div>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute right-64 top-20 hidden -rotate-6 rounded-2xl border border-border bg-surface/60 p-4 shadow-lg shadow-accent/5 sm:block"
          >
            <div className="grid gap-2">
              <div className="h-2 w-24 rounded-full bg-accent/35" />
              <div className="h-2 w-32 rounded-full bg-muted/40" />
            </div>
          </div>
          <div className="relative">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">
              Post-interview reports
            </p>
            <h1 className="mb-2 text-4xl font-semibold tracking-tight">Interview reports</h1>
            <p className="max-w-xl text-muted">
              Every interview with its transcript, analysis and AI-usage assessment.
            </p>
          </div>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" aria-hidden />}>
          <DashboardView />
        </Suspense>
      </main>
    </ThemeProvider>
  );
}
