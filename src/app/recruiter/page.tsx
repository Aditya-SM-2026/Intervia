import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";

export const metadata: Metadata = {
  title: "New interview",
};

/**
 * Same chrome as the reports dashboard (TopNav), so the recruiter moves
 * between Interviews / Roles / New interview without the navbar changing
 * underneath them.
 */
export default function RecruiterPage() {
  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold">New interview</h1>
        <p className="mt-1 mb-6 max-w-2xl text-muted">
          The job description and resume become the interview plan. You will see the plan
          before you send the link.
        </p>
        <CreateInterviewPanel />
      </main>
    </ThemeProvider>
  );
}