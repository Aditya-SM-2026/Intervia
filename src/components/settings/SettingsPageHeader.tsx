import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

/** The title every settings page shares; the sidebar does the navigating. */
export function SettingsPageHeader({ title, tip, right }: { title: string; tip: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        {title}
        <InfoTip text={tip} />
      </h1>
      {right}
    </div>
  );
}

/** Shown to team members on admin-only pages. */
export function AdminOnly() {
  return (
    <p className="rounded-2xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
      Only the admin can see this page. Ask them if you need something changed.
    </p>
  );
}
