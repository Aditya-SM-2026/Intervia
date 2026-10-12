"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Dropdown menu used by the bell, the avatar and the row actions. Renders in
 * a portal with fixed positioning clamped to the viewport, so menus at the
 * table's bottom-right edge never overflow. Keyboard support: the trigger
 * opens with Enter/Space/ArrowDown, items cycle with ArrowUp/ArrowDown and
 * Home/End, Escape closes and restores focus to the trigger, and clicking
 * outside closes without acting.
 */

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a non-interactive separator row after this item. */
  separatorAfter?: boolean;
}

interface MenuProps {
  /** The trigger element; Menu attaches click/keyboard/aria props to it. */
  trigger: ReactElement;
  items: MenuItem[];
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: "end" | "start";
  /** Accessible label for the menu panel. */
  label: string;
  /** Optional custom panel content (e.g. the bell list) rendered above the items. */
  header?: ReactNode;
  panelClassName?: string;
  /** Called when the menu opens or closes (e.g. to lazy-load panel data). */
  onOpenChange?: (open: boolean) => void;
}

const PANEL_MARGIN = 8;

function menuButtons(panel: HTMLDivElement | null): HTMLButtonElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"));
}

export function Menu({ trigger, items, align = "end", label, header, panelClassName, onOpenChange }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /** The trigger button, found through the wrapper (no ref forwarding). */
  const getTriggerElement = useCallback((): HTMLElement | null => {
    const child = containerRef.current?.children[0];
    return child instanceof HTMLElement ? child : null;
  }, []);
  const setOpenAndNotify = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const place = useCallback(() => {
    const anchor = getTriggerElement();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    let left = align === "end" ? rect.right - panelRect.width : rect.left;
    left = Math.max(PANEL_MARGIN, Math.min(left, window.innerWidth - panelRect.width - PANEL_MARGIN));
    let top = rect.bottom + 6;
    if (top + panelRect.height > window.innerHeight - PANEL_MARGIN) {
      top = Math.max(PANEL_MARGIN, rect.top - panelRect.height - 6);
    }
    setPosition({ top, left });
  }, [align, getTriggerElement]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Move focus into the menu so arrow-key navigation works immediately.
    menuButtons(panelRef.current)[0]?.focus();
    const onReflow = () => place();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || containerRef.current?.contains(target)) return;
      setOpenAndNotify(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAndNotify(false);
        getTriggerElement()?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpenAndNotify, getTriggerElement]);

  function onTriggerKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpenAndNotify(true);
    }
  }

  function onPanelKeyDown(event: ReactKeyboardEvent) {
    const buttons = menuButtons(panelRef.current);
    if (buttons.length === 0) return;
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const focusAt = (index: number) => {
      const clamped = ((index % buttons.length) + buttons.length) % buttons.length;
      buttons[clamped]?.focus();
    };
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(currentIndex - 1 < 0 ? buttons.length - 1 : currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(buttons.length - 1);
    } else if (event.key === "Tab") {
      setOpenAndNotify(false);
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    setOpenAndNotify(false);
    item.onSelect?.();
    getTriggerElement()?.focus();
  }

  const triggerElement = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    onClick: () => setOpenAndNotify(!open),
    onKeyDown: onTriggerKeyDown,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
  });

  return (
    <>
      <span ref={containerRef} className="contents">{triggerElement}</span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            style={{
              position: "fixed",
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? "visible" : "hidden",
            }}
            className={`z-50 min-w-44 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lg shadow-black/10 dark:shadow-black/40 ${panelClassName ?? ""}`}
          >
            {header}
            {items.map((item) => (
              <div key={item.id}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => select(item)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                    item.danger
                      ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      : "hover:bg-accent-soft"
                  }`}
                >
                  {item.icon && <span className="grid size-4 shrink-0 place-items-center">{item.icon}</span>}
                  {item.label}
                </button>
                {item.separatorAfter && <div className="my-1 border-t border-border" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}