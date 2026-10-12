import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardInterviewList } from "@/components/dashboard/DashboardInterviewList";

export const metadata: Metadata = {
  title: "Interviews",
};

export default function DashboardPage() {
  return (
    <AppShell current="interviews">
      <h1 className="text-3xl font-semibold">Interviews</h1>
      <p className="mt-1 mb-6 text-muted">
        Open an interview to read its scorecard, the evidence behind it and the transcript.
      </p>
      <DashboardInterviewList />
      <p className="mt-6 text-sm text-muted">
        The overall score combines answer quality, resume match, own-answer signals and
        on-camera behaviour.{" "}
        <Link href="/dashboard/preview" className="font-medium text-accent hover:underline">
          See an example of the full analysis
        </Link>
        .
      </p>
    </AppShell>
  );
}
