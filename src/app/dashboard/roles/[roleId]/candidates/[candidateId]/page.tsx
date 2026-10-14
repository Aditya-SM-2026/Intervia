import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { CandidateDetailView } from "@/components/roles/CandidateDetailView";

export const metadata: Metadata = {
  title: "Candidate report",
};

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ roleId: string; candidateId: string }>;
}) {
  const { roleId, candidateId } = await params;
  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <CandidateDetailView roleId={roleId} candidateId={candidateId} />
      </main>
    </ThemeProvider>
  );
}