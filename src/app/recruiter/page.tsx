import type { Metadata } from "next";
import Link from "next/link";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";

export const metadata: Metadata = {
  title: "Create an interview",
};

export default function RecruiterPage() {
  return (
<main className="mx-auto flex min-h-dvh w-full flex-col p-4 sm:p-6">
      <Link href="/" className="mb-4 inline-flex items-center gap-2 font-semibold tracking-tight">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-sm text-white">I</span>
        Intervia
      </Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Create an interview</h1>
      <div className="flex-1 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <CreateInterviewPanel />
      </div>
    </main>
  );
}