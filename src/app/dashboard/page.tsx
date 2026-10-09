import type { Metadata } from "next";
import Link from "next/link";
import { DashboardInterviewList } from "@/components/dashboard/DashboardInterviewList";

export const metadata: Metadata = {
  title: "Interview dashboard",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-4xl p-6 sm:p-8">
      <div className="mb-10 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-sm text-white">I</span>
          Intervia
        </Link>
        <Link
          href="/recruiter"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          New interview
        </Link>
      </div>
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">
          Post-interview reports
        </p>
        <h1 className="mb-1 text-3xl font-semibold tracking-tight">Interview dashboard</h1>
        <p className="text-sm text-muted">
          Every interview with its transcript, analysis and AI-usage assessment.
        </p>
      </div>
      <DashboardInterviewList />
    </main>
  );
}