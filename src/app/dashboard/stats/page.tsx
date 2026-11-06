import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { StatsView } from "@/components/dashboard/StatsView";
import { ThemeProvider } from "@/components/dashboard/theme";

export const metadata: Metadata = { title: "Stats" };

export default function StatsPage() {
  return (
    <ThemeProvider>
      <TopNav />
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-16 -z-10 h-[420px]" />
      <main className="relative mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
        <StatsView />
      </main>
    </ThemeProvider>
  );
}
