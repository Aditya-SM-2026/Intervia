import type { Metadata } from "next";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";

export const metadata: Metadata = {
  title: "Recruiter — Create Interview",
};

export default function RecruiterPage() {
  return (
    <main className="mx-auto w-full max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Create an interview</h1>
      <p className="mb-6 text-sm text-muted">
        Generate a shareable link the candidate opens in their browser.
      </p>
      <div className="rounded-xl border border-border bg-surface p-6">
        <CreateInterviewPanel />
      </div>
    </main>
  );
}