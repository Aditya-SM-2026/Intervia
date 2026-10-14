import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { CandidateDetailView } from "@/components/roles/CandidateDetailView";

export const metadata: Metadata = {
  title: "Candidate",
};

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ roleId: string; candidateId: string }>;
}) {
  const { roleId, candidateId } = await params;
  return (
    <AppShell current="roles">
      <CandidateDetailView roleId={roleId} candidateId={candidateId} />
    </AppShell>
  );
}