import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { InfoTip } from "@/components/ui/InfoTip";

/** The back link and title every settings sub-page shares. */
export function SettingsPageHeader({ title, tip }: { title: string; tip: string }) {
  return (
    <div className="py-10">
      <Link href="/dashboard/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Settings
      </Link>
      <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
        {title}
        <InfoTip text={tip} />
      </h1>
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
