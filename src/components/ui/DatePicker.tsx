"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

/** "YYYY-MM-DD" in local time, the same shape a native date input uses. */
export type DateValue = string;

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const POPOVER_WIDTH = 296;
const POPOVER_HEIGHT = 348;

function toKey(date: Date): DateValue {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromKey(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Six weeks of days starting on the Monday on or before the 1st. */
function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/**
 * A date field with a calendar popover, in place of the browser's date input,
 * which looks different in every browser and ignores the app's theme.
 * The popover is portalled to the body so sheets and dialogs never clip it.
 */
export function DatePicker({
  value,
  onChange,
  min,
  placeholder = "Pick a date",
  clearable = true,
  className = "",
  name,
  id,
  "aria-label": ariaLabel,
}: {
  value: DateValue;
  onChange: (value: DateValue) => void;
  min?: DateValue;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  name?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const selected = fromKey(value);
  const minDate = fromKey(min);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(selected ?? new Date()));
  const [focus, setFocus] = useState<Date>(() => selected ?? new Date());
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const below = window.innerHeight - rect.bottom;
    const top = below < POPOVER_HEIGHT + gap && rect.top > POPOVER_HEIGHT + gap ? rect.top - POPOVER_HEIGHT - gap : rect.bottom + gap;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8);
    setPosition({ top, left });
  }, []);

  function openPicker() {
    const start = selected ?? (minDate && minDate > new Date() ? minDate : new Date());
    setMonth(startOfMonth(start));
    setFocus(start);
    place();
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(date: Date) {
    if (minDate && date < minDate) return;
    onChange(toKey(date));
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Keep keyboard focus on the focused day as it moves.
  useEffect(() => {
    if (!open) return;
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toKey(focus)}"]`);
    button?.focus({ preventScroll: true });
  }, [open, focus, month]);

  function moveFocus(next: Date) {
    setFocus(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(startOfMonth(next));
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(addDays(focus, moves[event.key]));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const delta = event.key === "PageUp" ? -1 : 1;
      moveFocus(new Date(focus.getFullYear(), focus.getMonth() + delta, Math.min(focus.getDate(), 28)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (focus.getDay() + 6) % 7;
      moveFocus(addDays(focus, event.key === "Home" ? -weekday : 6 - weekday));
    }
  }

  const todayKey = toKey(new Date());
  const selectedKey = selected ? toKey(selected) : null;
  const label = selected
    ? selected.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : placeholder;
  const prevDisabled = Boolean(minDate && startOfMonth(month) <= startOfMonth(minDate));

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <span className="relative block">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={ariaLabel ? `${ariaLabel}: ${selected ? label : "not set"}` : undefined}
          onClick={() => (open ? close() : openPicker())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              openPicker();
            }
          }}
          className={`flex w-full items-center gap-2 text-left ${clearable && selected ? "pr-9" : ""} ${className}`}
        >
          <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
          <span className={`truncate ${selected ? "text-foreground" : "text-muted"}`}>{label}</span>
        </button>
        {clearable && selected && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear date"
            className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </span>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            id={dialogId}
            role="dialog"
            aria-label="Choose a date"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
            style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
            className="date-pop fixed z-[80] rounded-2xl border border-border bg-surface p-3 text-foreground shadow-xl shadow-slate-900/10"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                disabled={prevDisabled}
                aria-label="Previous month"
                className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <p className="text-sm font-semibold" aria-live="polite">
                {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </p>
              <button
                type="button"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                aria-label="Next month"
                className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium text-muted" aria-hidden>
              {WEEKDAYS.map((day) => (
                <span key={day} className="py-1">
                  {day}
                </span>
              ))}
            </div>

            <div ref={gridRef} role="grid" onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
              {monthGrid(month).map((day) => {
                const key = toKey(day);
                const outside = day.getMonth() !== month.getMonth();
                const disabled = Boolean(minDate && day < minDate);
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                const isFocus = key === toKey(focus);
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    data-day={key}
                    tabIndex={isFocus ? 0 : -1}
                    disabled={disabled}
                    aria-selected={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    onClick={() => pick(day)}
                    className={`relative grid h-9 place-items-center rounded-lg text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-25 ${
                      isSelected
                        ? "bg-accent font-semibold text-white"
                        : outside
                          ? "text-muted/60 hover:bg-foreground/[0.05]"
                          : "hover:bg-foreground/[0.06]"
                    } ${isToday && !isSelected ? "font-semibold text-accent" : ""}`}
                  >
                    {day.getDate()}
                    {isToday && !isSelected && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-accent" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={() => pick(new Date())}
                disabled={Boolean(minDate && new Date(new Date().setHours(0, 0, 0, 0)) < minDate)}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-30"
              >
                Today
              </button>
              {clearable && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    close();
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
