import type { Metadata } from "next";
import Link from "next/link";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";

export const metadata: Metadata = {
  title: "Create an interview",
};

export default function RecruiterPage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link href="/" className="mb-10 inline-flex items-center gap-2 font-semibold tracking-tight">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-sm text-white">I</span>
        Intervia
      </Link>
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">
          AI-powered conversations for better hiring
        </p>
        <h1 className="mb-1 text-3xl font-semibold tracking-tight">Create an interview</h1>
        <p className="text-sm text-muted">
          Generate a shareable link the candidate opens in their browser.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <CreateInterviewPanel />
      </div>
    </main>
  );
}