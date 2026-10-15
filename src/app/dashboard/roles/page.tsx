import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { RolesView } from "@/components/roles/RolesView";

export const metadata: Metadata = {
  title: "Roles",
};

export default function RolesPage() {
  return (
    <ThemeProvider><TopNav /><main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <RolesView />
    </main></ThemeProvider>
  );
}
