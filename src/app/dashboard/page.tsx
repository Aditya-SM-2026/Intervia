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
        <header className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10 sm:pt-12">
          <div>
            <h1 className="font-display text-4xl font-normal tracking-tight text-foreground sm:text-[2.75rem]">Interviews</h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted">
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
