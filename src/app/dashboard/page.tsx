import type { Metadata } from "next";
import { Suspense } from "react";
import { TopNav } from "@/components/dashboard/TopNav";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { ThemeProvider } from "@/components/dashboard/theme";

export const metadata: Metadata = {
  title: "Interviews",
};

/** The interviews list: page title, activity overview and the table. */
export default function DashboardPage() {
  return (
    <ThemeProvider>
      <TopNav />
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-16 -z-10 h-[420px]" />
      <main className="relative mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 pb-7 pt-9">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground">Interviews</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Every interview you have sent, and its report once the candidate finishes.
            </p>
          </div>
        </header>
        <Suspense fallback={<div className="skeleton h-64 rounded-3xl" aria-hidden />}>
          <DashboardView />
        </Suspense>
      </main>
    </ThemeProvider>
  );
}
