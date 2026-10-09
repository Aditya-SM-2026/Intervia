import type { Metadata } from "next";
import { DashboardReportView } from "@/components/dashboard/DashboardReportView";

export const metadata: Metadata = {
  title: "Interview report",
};

export default async function InterviewReportPage({
  params,
}: PageProps<"/dashboard/[roomId]">) {
  const { roomId } = await params;
  return (
    <main className="mx-auto w-full max-w-4xl p-6 sm:p-8">
      <DashboardReportView roomId={roomId} />
    </main>
  );
}