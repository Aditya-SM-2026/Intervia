"use client";

import Link from "next/link";
import { useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Search, UserRound } from "lucide-react";

interface Suggestion {
  href: string;
  title: string;
  detail: string;
  kind: "candidate" | "role";
}

/**
 * The header search: suggests matching candidates and roles while typing;
 * Enter opens the full filtered interviews list.
 */
export function HeaderSearch({ inputRef, shortcutHint }: { inputRef: RefObject<HTMLInputElement | null>; shortcutHint: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  function lookUp(term: string) {
    latest.current = term;
    if (timer.current) clearTimeout(timer.current);
    if (term.length < 2) {
      setItems([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const q = encodeURIComponent(term);
      const [interviews, roles] = await Promise.all([
        fetch(`/api/dashboard/interviews?q=${q}&limit=5`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/roles?q=${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (latest.current !== term) return;
      const people: Suggestion[] = ((interviews?.interviews ?? []) as { room: { id: string; candidateName: string | null; candidateEmail: string | null; roleTitle: string | null; title: string } }[]).map(
        ({ room }) => ({
          href: `/dashboard/${room.id}`,
          title: room.candidateName ?? room.candidateEmail ?? "Unnamed candidate",
          detail: room.roleTitle ?? room.title,
          kind: "candidate",
        }),
      );
      const roleItems: Suggestion[] = ((roles?.roles ?? []) as { id: string; title: string; status: string }[]).slice(0, 4).map((role) => ({
        href: `/dashboard/roles/${role.id}`,
        title: role.title,
        detail: role.status === "completed" ? "Closed role" : "Role",
        kind: "role",
      }));
      setItems([...roleItems, ...people]);
      setOpen(true);
    }, 200);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setOpen(false);
    const term = query.trim();
    router.push(term ? `/dashboard?q=${encodeURIComponent(term)}` : "/dashboard");
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="relative hidden sm:block"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          lookUp(event.target.value.trim());
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        placeholder="Search…"
        autoComplete="off"
        aria-label="Search candidates, roles, or reports"
        aria-controls="header-search-results"
        className="h-9 w-52 rounded-lg border border-border bg-background/60 pl-9 pr-12 text-sm outline-none transition placeholder:text-muted hover:border-foreground/20 focus:w-72 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 lg:w-64"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">
        {shortcutHint}
      </kbd>
      {open && query.trim().length >= 2 && (
        <div id="header-search-results" className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/10">
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-foreground/[0.04] focus:bg-foreground/[0.04] focus:outline-none"
                  >
                    {item.kind === "role" ? <Briefcase className="size-4 shrink-0 text-muted" aria-hidden /> : <UserRound className="size-4 shrink-0 text-muted" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button type="submit" className="w-full border-t border-border px-4 py-2.5 text-left text-xs font-medium text-accent hover:bg-accent/5">
            See all interviews matching &ldquo;{query.trim()}&rdquo;
          </button>
        </div>
      )}
    </form>
  );
}
