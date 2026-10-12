"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, FileText, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import type { DashboardAnalytics } from "@/lib/interviews/interview.types";
import { Avatar } from "./primitives";
import { Menu } from "./menu";
import { useTheme } from "./theme";

/**
 * Top navigation (no sidebar): brand, primary links, global search with a
 * ⌘K shortcut, new-interview action, a notification bell driven by real
 * awaiting-analysis data, and the user menu holding the theme control. Every
 * control navigates or filters — no placeholder actions.
 */

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/recruiter", label: "Interviews" },
  { href: "/dashboard", label: "Reports" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState(false);

  // Focus the global search with ⌘K / Ctrl+K.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadBellData = useCallback(() => {
    setAnalyticsError(false);
    fetch("/api/dashboard/interviews/analytics")
      .then((response) => {
        if (!response.ok) throw new Error("analytics request failed");
        return response.json() as Promise<DashboardAnalytics>;
      })
      .then((data) => setAnalytics(data))
      .catch(() => setAnalyticsError(true));
  }, []);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = new FormData(event.target as HTMLFormElement).get("q");
    const term = typeof query === "string" ? query.trim() : "";
    router.push(term ? `/dashboard?q=${encodeURIComponent(term)}` : "/dashboard");
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const shortcutHint = isMac ? "⌘K" : "Ctrl K";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Intervia home">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-semibold text-white">I</span>
            <span className="text-lg font-semibold tracking-tight">Intervia</span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-lg px-3 py-2 text-sm font-medium transition hover:text-foreground ${
                    active ? "text-foreground" : "text-muted"
                  }`}
                >
                  {link.label}
                  {active && (
                    <span aria-hidden className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <form role="search" onSubmit={submitSearch} className="relative hidden sm:block">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              name="q"
              placeholder="Search candidates, roles, or reports…"
              aria-label="Search candidates, roles, or reports"
              className="w-56 rounded-xl border border-border bg-background py-2 pl-9 pr-14 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 lg:w-72"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">
              {shortcutHint}
            </kbd>
          </form>

          <Link
            href="/recruiter"
            className="hidden items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-85 sm:inline-flex"
          >
            <Plus className="size-4" aria-hidden />
            New interview
          </Link>

          <Menu
            label="Notifications"
            align="end"
            panelClassName="w-80"
            onOpenChange={(open) => {
              setBellOpen(open);
              if (open) loadBellData();
            }}
            trigger={
              <button
                type="button"
                aria-label={`Notifications${analytics && analytics.awaitingRecent.length > 0 ? ` (${analytics.awaitingRecent.length} awaiting analysis)` : ""}`}
                className="relative grid size-9 place-items-center rounded-xl border border-transparent text-muted transition hover:border-border hover:bg-background hover:text-foreground"
              >
                <Bell className="size-[18px]" aria-hidden />
                {bellOpen && analytics && analytics.awaitingRecent.length > 0 && (
                  <span className="absolute right-2 top-2 size-2 rounded-full bg-red-500 ring-2 ring-surface" aria-hidden />
                )}
              </button>
            }
            header={
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-sm font-semibold">Awaiting analysis</p>
                <p className="text-xs text-muted">Completed interviews without a report yet</p>
              </div>
            }
            items={[
              ...(analyticsError
                ? [{ id: "error", label: "Could not load notifications.", disabled: true }]
                : analytics === null
                  ? [{ id: "loading", label: "Loading…", disabled: true }]
                  : analytics.awaitingRecent.length === 0
                    ? [{ id: "empty", label: "No interviews are awaiting analysis.", disabled: true }]
                    : analytics.awaitingRecent.slice(0, 8).map((item) => ({
                        id: item.roomId,
                        label: `${item.candidateName ?? "Unnamed candidate"} — ${item.roleTitle ?? "interview"}`,
                        icon: <FileText className="size-4 text-accent" aria-hidden />,
                        onSelect: () => router.push(`/dashboard/${item.roomId}`),
                      }))),
            ]}
          />

          <Menu
            label="User menu"
            align="end"
            trigger={
              <button
                type="button"
                aria-label="User menu"
                className="flex items-center gap-1.5 rounded-xl border border-transparent p-1 transition hover:border-border hover:bg-background"
              >
                <Avatar name="Recruiter" className="size-8 text-xs" />
              </button>
            }
            header={
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-sm font-semibold">Recruiter workspace</p>
                <p className="text-xs text-muted">Appearance</p>
                <ThemeControl />
              </div>
            }
            items={[
              { id: "create", label: "Create interview", icon: <Plus className="size-4" aria-hidden />, onSelect: () => router.push("/recruiter") },
              { id: "reports", label: "All reports", icon: <FileText className="size-4" aria-hidden />, onSelect: () => router.push("/dashboard") },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

/** Light / Dark / System segmented control, persisted via the ThemeProvider. */
function ThemeControl() {
  const { preference, setPreference } = useTheme();
  const options = [
    { value: "light" as const, label: "Light", icon: <Sun className="size-3.5" aria-hidden /> },
    { value: "dark" as const, label: "Dark", icon: <Moon className="size-3.5" aria-hidden /> },
    { value: "system" as const, label: "System", icon: <Monitor className="size-3.5" aria-hidden /> },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          onClick={() => setPreference(option.value)}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            preference === option.value
              ? "bg-accent text-white shadow-xs"
              : "text-muted hover:bg-accent-soft hover:text-foreground"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}