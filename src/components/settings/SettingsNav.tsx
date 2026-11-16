"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, History, KeyRound, LayoutGrid, Mic, Users } from "lucide-react";

const ICONS = { overview: LayoutGrid, agent: Bot, voice: Mic, team: Users, activity: History, account: KeyRound } as const;

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}
export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

/**
 * Settings navigation: a sticky sidebar on wide screens, a row of tabs that
 * scrolls sideways on phones. Every settings page is one click from every other.
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  const all = groups.flatMap((group) => group.items);
  const isActive = (href: string) => (href === "/dashboard/settings" ? pathname === href : pathname.startsWith(href));

  return (
    <>
      {/* Phones and tablets */}
      <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-1 border-b border-border">
          {all.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Wide screens */}
      <nav aria-label="Settings" className="sticky top-24 hidden self-start lg:block">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        active ? "bg-accent/10 text-accent" : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
