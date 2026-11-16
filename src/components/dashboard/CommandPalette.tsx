"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  BarChart3,
  Bot,
  Briefcase,
  CornerDownLeft,
  KeyRound,
  LayoutList,
  Mic,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { EASE_OUT } from "@/components/ui/animated";
import { useTheme } from "./theme";

interface Command {
  id: string;
  group: "Actions" | "Go to" | "Roles" | "Candidates" | "Theme";
  label: string;
  detail?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const subscribeNothing = () => () => {};
const icon = "size-4";

/**
 * Mount it with a new key each time it opens, so it starts empty.
 *
 * ⌘K command palette: jump to any page, open a role or a candidate's report,
 * start a new interview or role, or switch the theme, from the keyboard.
 * Typing two or more letters also searches candidates and roles.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { setPreference } = useTheme();
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Command[]>([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef("");

  const go = useCallback(
    (href: string) => () => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const fixed: Command[] = useMemo(
    () => [
      { id: "new-interview", group: "Actions", label: "New interview", icon: <Plus className={icon} />, keywords: "create invite schedule", run: go("/recruiter") },
      { id: "new-role", group: "Actions", label: "New role", icon: <Plus className={icon} />, keywords: "create job opening", run: () => {
        if (window.location.pathname === "/dashboard/roles") {
          onClose();
          window.dispatchEvent(new Event("intervia:new-role"));
        } else go("/dashboard/roles?new=1")();
      } },
      { id: "interviews", group: "Go to", label: "Interviews", icon: <LayoutList className={icon} />, keywords: "reports list home", run: go("/dashboard") },
      { id: "roles", group: "Go to", label: "Roles", icon: <Briefcase className={icon} />, keywords: "jobs openings", run: go("/dashboard/roles") },
      { id: "stats", group: "Go to", label: "Stats", icon: <BarChart3 className={icon} />, keywords: "analytics cost funnel", run: go("/dashboard/stats") },
      { id: "settings", group: "Go to", label: "Settings", icon: <Settings className={icon} />, run: go("/dashboard/settings") },
      { id: "behaviour", group: "Go to", label: "Interviewer behaviour", detail: "Settings", icon: <Bot className={icon} />, keywords: "agent persona conduct prompt", run: go("/dashboard/settings/agent") },
      { id: "voice", group: "Go to", label: "Voice and engine", detail: "Settings", icon: <Mic className={icon} />, keywords: "agent voice sample", run: go("/dashboard/settings/voice") },
      { id: "team", group: "Go to", label: "Team", detail: "Settings", icon: <Users className={icon} />, keywords: "members people accounts", run: go("/dashboard/settings/team") },
      { id: "activity", group: "Go to", label: "Activity", detail: "Settings", icon: <Activity className={icon} />, keywords: "log audit history", run: go("/dashboard/settings/activity") },
      { id: "password", group: "Go to", label: "Your password", detail: "Settings", icon: <KeyRound className={icon} />, keywords: "account change password", run: go("/dashboard/settings/account") },
      { id: "light", group: "Theme", label: "Light theme", icon: <Sun className={icon} />, keywords: "appearance", run: () => { setPreference("light"); onClose(); } },
      { id: "dark", group: "Theme", label: "Dark theme", icon: <Moon className={icon} />, keywords: "appearance", run: () => { setPreference("dark"); onClose(); } },
      { id: "system", group: "Theme", label: "Match the system theme", icon: <Monitor className={icon} />, keywords: "appearance auto", run: () => { setPreference("system"); onClose(); } },
    ],
    [go, onClose, setPreference],
  );

  // Candidates and roles matching the query, from the same endpoints the lists use.
  useEffect(() => {
    const term = query.trim();
    latest.current = term;
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      // The list search matches whole words; while a word is half typed, fall back to the finished ones.
      const lookUp = (text: string) =>
        Promise.all([
          fetch(`/api/dashboard/interviews?q=${encodeURIComponent(text)}&limit=6`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`/api/roles?q=${encodeURIComponent(text)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
      let [interviews, roles] = await lookUp(term);
      const finished = term.split(/\s+/).slice(0, -1).join(" ");
      if (!interviews?.interviews?.length && !roles?.roles?.length && finished.length >= 2) {
        [interviews, roles] = await lookUp(finished);
      }
      if (latest.current !== term) return;
      const roleCommands: Command[] = ((roles?.roles ?? []) as { id: string; title: string; status: string }[]).slice(0, 5).map((role) => ({
        id: `role-${role.id}`,
        group: "Roles",
        label: role.title,
        detail: role.status === "completed" ? "Closed" : undefined,
        icon: <Briefcase className={icon} />,
        run: go(`/dashboard/roles/${role.id}`),
      }));
      type Row = { room: { id: string; candidateName: string | null; candidateEmail: string | null; roleTitle: string | null; title: string } };
      const people: Command[] = ((interviews?.interviews ?? []) as Row[]).map(({ room }) => ({
        id: `room-${room.id}`,
        group: "Candidates",
        label: room.candidateName ?? room.candidateEmail ?? "Unnamed candidate",
        detail: room.roleTitle ?? room.title,
        icon: <UserRound className={icon} />,
        run: go(`/dashboard/${room.id}`),
      }));
      setFound([...people, ...roleCommands]);
      setSearching(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, go]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? fixed.filter((c) => `${c.label} ${c.detail ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(term))
      : fixed;
    const all = [...found, ...matches];
    if (term.length >= 2) {
      all.push({
        id: "search-all",
        group: "Actions",
        label: `All interviews matching “${query.trim()}”`,
        icon: <Search className={icon} />,
        run: go(`/dashboard?q=${encodeURIComponent(query.trim())}`),
      });
    }
    return all;
  }, [fixed, found, query, go]);

  function changeQuery(next: string) {
    setQuery(next);
    setActive(0);
    const searchable = next.trim().length >= 2;
    setSearching(searchable);
    if (!searchable) setFound([]);
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      visible[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  if (!isClient) return null;

  let index = -1;
  const groups = ["Candidates", "Roles", "Actions", "Go to", "Theme"] as const;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/20"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4.5 shrink-0 text-muted" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder="Search candidates, roles, pages…"
                aria-label="Search or run a command"
                aria-controls="command-list"
                aria-activedescendant={visible[active] ? `cmd-${visible[active].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">Esc</kbd>
            </div>
            <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              {visible.length === 0 && !searching && (
                <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>
              )}
              {groups.map((group) => {
                const items = visible.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="pb-1">
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{group}</p>
                    {items.map((command) => {
                      index = visible.indexOf(command);
                      const selected = index === active;
                      const myIndex = index;
                      return (
                        <div
                          key={command.id}
                          id={`cmd-${command.id}`}
                          role="option"
                          aria-selected={selected}
                          data-index={myIndex}
                          onMouseMove={() => setActive(myIndex)}
                          onClick={() => command.run()}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                            selected ? "bg-accent/10 text-foreground" : "text-foreground/90"
                          }`}
                        >
                          <span className={selected ? "text-accent" : "text-muted"} aria-hidden>
                            {command.icon}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                          {command.detail && <span className="max-w-[45%] truncate text-xs text-muted">{command.detail}</span>}
                          {selected && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {searching && <p className="px-3 py-2 text-xs text-muted">Searching…</p>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
