import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { RolesView } from "@/components/roles/RolesView";

export const metadata: Metadata = {
  title: "Roles",
};

export default function RolesPage() {
  return (
    <AppShell current="roles">
      <h1 className="text-3xl font-semibold">Roles</h1>
      <p className="mt-1 mb-6 text-muted">
        Open a role to see its candidates, their interview results and to export a hiring report.
      </p>
      <RolesView />
    </AppShell>
  );
}