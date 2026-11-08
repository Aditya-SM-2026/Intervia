"use client";

import { useState } from "react";
import { Info } from "lucide-react";

/**
 * An (i) button that explains a heading or number on hover, focus or tap,
 * instead of a line of text under it that everyone has to read past.
 */
export function InfoTip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="What this means"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="grid size-5 place-items-center rounded-full text-muted transition hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-30 mt-1.5 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-foreground/85 shadow-lg shadow-black/[0.08] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
