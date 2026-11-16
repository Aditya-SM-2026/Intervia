"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { usePathname, useRouter } from "next/navigation";
import { Bell, FileText, LogOut, Monitor, Moon, Plus, Search, Settings, Sun } from "lucide-react";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
import { Avatar } from "./primitives";
import { CommandPalette } from "./CommandPalette";
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
        !pathname.startsWith("/dashboard/stats") &&
        !pathname.startsWith("/dashboard/settings"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteKey, setPaletteKey] = useState(0);
  const openPalette = useCallback(() => {
    setPaletteKey((key) => key + 1);
    setPaletteOpen(true);
  }, []);
  const [bellOpen, setBellOpen] = useState(false);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [accountName, setAccountName] = useState("Admin");
  const [accountDetail, setAccountDetail] = useState("Medhas Academy");

  // The signed-in account's name, shown on the avatar and in the user menu.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => (response.ok ? (response.json() as Promise<{ name?: string; email?: string | null; admin?: boolean }>) : null))
      .then((data) => {
        if (cancelled || !data?.name) return;
        setAccountName(data.name);
        setAccountDetail(data.admin ? "Admin · Medhas Academy" : data.email ?? "Medhas Academy");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ⌘K / Ctrl+K opens the command palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) setPaletteOpen(false);
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, openPalette]);

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


  // The server cannot know the visitor's keyboard. Render the same label on
  // both sides first and switch after hydration, or React rebuilds the page
  // (error 418) on every load.
  const isMac = useSyncExternalStore(
    noSubscription,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  const shortcutHint = isMac ? "⌘K" : "Ctrl K";

  /** Clears the session and lands on the sign-in page. */
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface md:bg-surface/85 md:backdrop-blur-xl md:supports-[backdrop-filter]:bg-surface/75">
      <CommandPalette key={paletteKey} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search and commands"
            className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-border bg-background/60 pl-3 pr-2 text-sm text-muted transition hover:border-foreground/20 hover:text-foreground sm:flex lg:w-64"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">{shortcutHint}</kbd>
          </button>
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search and commands"
            className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground sm:hidden"
          >
            <Search className="size-[18px]" aria-hidden />
          </button>

          <Link
            href="/recruiter"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 active:scale-[0.98] sm:inline-flex"
          >
            <Plus className="size-4" aria-hidden />
            New interview
          </Link>

          {/* Phones: the same action as an icon, so creating is never out of reach. */}
          <Link
            href="/recruiter"
            aria-label="New interview"
            className="grid size-9 place-items-center rounded-lg bg-accent text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 sm:hidden"
          >
            <Plus className="size-4" aria-hidden />
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
                        label: `${item.candidateName ?? "Unnamed candidate"} · ${item.roleTitle ?? "interview"}`,
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
                <Avatar name={accountName} className="size-8 text-xs" />
              </button>
            }
            header={
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-sm font-semibold">{accountName}</p>
                <p className="max-w-56 truncate text-xs text-muted">{accountDetail}</p>
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
      {/* Small screens: the section links get their own row instead of disappearing. */}
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {NAV_LINKS.map((link) => {
          const active = isActiveLink(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-foreground/[0.06] text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
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

/** The keyboard never changes while the page is open. */
function noSubscription(): () => void {
  return () => {};
}
