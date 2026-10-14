import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { RoleDetailView } from "@/components/roles/RoleDetailView";

export const metadata: Metadata = {
  title: "Role",
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return (
    <AppShell current="roles">
      <RoleDetailView roleId={roleId} />
    </AppShell>
  );
}