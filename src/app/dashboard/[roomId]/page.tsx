import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { InterviewDetailView } from "@/components/dashboard/InterviewDetailView";

export const metadata: Metadata = {
  title: "Interview scorecard",
};

/** Same TopNav chrome as the dashboard; the report opens under "Interviews". */
export default async function InterviewReportPage({
  params,
}: PageProps<"/dashboard/[roomId]">) {
  const { roomId } = await params;
  return (
    <ThemeProvider>
      <TopNav />
      <main className="min-h-[calc(100vh-64px)] w-full bg-[#f8fafc] px-4 py-6 sm:px-6 lg:px-8 dark:bg-background">
        <InterviewDetailView roomId={roomId} />
      </main>
    </ThemeProvider>
  );
}
