import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { InterviewDetailView } from "@/components/dashboard/InterviewDetailView";

export const metadata: Metadata = {
  title: "Interview scorecard",
};

export default async function InterviewReportPage({
  params,
}: PageProps<"/dashboard/[roomId]">) {
  const { roomId } = await params;
  return (
    <AppShell current="interviews" wide>
      <InterviewDetailView roomId={roomId} />
    </AppShell>
  );
}