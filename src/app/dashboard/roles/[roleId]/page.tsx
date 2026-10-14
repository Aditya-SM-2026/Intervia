import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { RoleDetailView } from "@/components/roles/RoleDetailView";

export const metadata: Metadata = {
  title: "Role candidates",
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <RoleDetailView roleId={roleId} />
      </main>
    </ThemeProvider>
  );
}