import { notFound } from "next/navigation";
import { ThemeProvider } from "@/components/dashboard/theme";
import { InterviewDetailView } from "@/components/dashboard/InterviewDetailView";
import { PREVIEW_DETAIL } from "./fixture";

/** Design preview of the interview report with sample data. Local development only. */
export default function ReportPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <ThemeProvider>
      <main className="min-h-screen w-full px-4 sm:px-6">
        <InterviewDetailView roomId="preview" initialDetail={PREVIEW_DETAIL} />
      </main>
    </ThemeProvider>
  );
}
