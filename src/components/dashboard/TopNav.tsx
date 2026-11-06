"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { usePathname, useRouter } from "next/navigation";
import { Bell, FileText, LogOut, Monitor, Moon, Plus, Search, Settings, Sun } from "lucide-react";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
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
  { href: "/dashboard", label: "Interviews" },
  { href: "/dashboard/roles", label: "Roles" },
  { href: "/dashboard/stats", label: "Stats" },
] as const;

/**
 * One link highlights at a time: the roles section (a subtree of /dashboard)
 * belongs to "Roles", everything else under /dashboard to "Interviews".
 */
function isActiveLink(pathname: string, href: string): boolean {
  if (href === "/dashboard/roles" || href === "/dashboard/stats") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (href === "/dashboard") {
    return (
      pathname === "/dashboard" ||
      (pathname.startsWith("/dashboard/") &&
        !pathname.startsWith("/dashboard/roles") &&
        !pathname.startsWith("/dashboard/stats"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

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

  /** Clears the session and lands on the sign-in page. */
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <BrandMark href="/dashboard" />
          <span aria-hidden className="hidden h-6 w-px bg-border md:block" />
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = isActiveLink(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-muted hover:bg-foreground/[0.04] hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <form role="search" onSubmit={submitSearch} className="relative hidden sm:block">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              name="q"
              placeholder="Search…"
              aria-label="Search candidates, roles, or reports"
              className="h-9 w-52 rounded-lg border border-border bg-background/60 pl-9 pr-12 text-sm outline-none transition placeholder:text-muted hover:border-foreground/20 focus:w-72 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 lg:w-64"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">
              {shortcutHint}
            </kbd>
          </form>

          <Link
            href="/recruiter"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 active:scale-[0.98] sm:inline-flex"
          >
            <Plus className="size-4" aria-hidden />
            New interview
          </Link>

          <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />

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
                className="relative grid size-9 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
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
                className="flex items-center rounded-full p-0.5 transition hover:ring-4 hover:ring-foreground/[0.06]"
              >
                <Avatar name="Recruiter" className="size-8 text-xs" />
              </button>
            }
            header={
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-sm font-semibold">Recruiter</p>
                <p className="text-xs text-muted">Medhas Academy</p>
                <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-muted">Theme</p>
                <ThemeControl />
              </div>
            }
            items={[
              { id: "settings", label: "Settings", icon: <Settings className="size-4" aria-hidden />, onSelect: () => router.push("/dashboard/settings") },
              { id: "signout", label: "Sign out", icon: <LogOut className="size-4" aria-hidden />, onSelect: () => void signOut() },
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
    <div role="radiogroup" aria-label="Theme" className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-foreground/[0.05] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          onClick={() => setPreference(option.value)}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            preference === option.value
              ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
              : "text-muted hover:text-foreground"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
