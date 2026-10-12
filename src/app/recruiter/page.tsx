import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { CreateInterviewPanel } from "@/components/recruiter/CreateInterviewPanel";

export const metadata: Metadata = {
  title: "New interview",
};

export default function RecruiterPage() {
  return (
    <AppShell current="new" wide>
      <h1 className="text-3xl font-semibold">New interview</h1>
      <p className="mt-1 mb-6 max-w-2xl text-muted">
        The job description and resume become the interview plan. You will see the plan
        before you send the link.
      </p>
      <CreateInterviewPanel />
    </AppShell>
  );
}
