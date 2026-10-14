import type { Metadata } from "next";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { RolesView } from "@/components/roles/RolesView";

export const metadata: Metadata = {
  title: "Roles",
};

export default function RolesPage() {
  return (
    <ThemeProvider><TopNav /><main className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Roles</h1>
      <p className="mt-1 mb-6 text-muted">
        Open a role to see its candidates, their interview results and to export a hiring report.
      </p>
      <RolesView />
    </main></ThemeProvider>
  );
}
