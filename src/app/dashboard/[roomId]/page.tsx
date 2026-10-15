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
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <InterviewDetailView roomId={roomId} />
      </main>
    </ThemeProvider>
  );
}