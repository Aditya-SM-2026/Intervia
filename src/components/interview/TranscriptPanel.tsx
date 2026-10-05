"use client";

import { useEffect, useRef } from "react";

export interface TranscriptEntry {
  role: "candidate" | "interviewer";
  text: string;
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  /** Interim (still-being-recognized) candidate text. */
  interim: string | null;
}

export function TranscriptPanel({ entries, interim }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries, interim]);

  return (
    <div
      ref={scrollRef}
      aria-label="Interview transcript"
      className="h-64 overflow-y-auto rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed lg:h-auto lg:min-h-0 lg:flex-1"
    >
      {entries.length === 0 && !interim && (
        <p className="text-xs text-muted">
          The conversation transcript appears here as you speak.
        </p>
      )}
      <ul className="grid gap-2">
        {entries.map((entry, index) => (
          <li key={index} className={entry.role === "candidate" ? "" : "text-left"}>
            <span
              className={`mb-0.5 block text-[10px] font-medium uppercase tracking-wide ${
                entry.role === "candidate" ? "text-muted" : "text-accent"
              }`}
            >
              {entry.role === "candidate" ? "You" : "Intervia AI"}
            </span>
            {entry.text}
          </li>
        ))}
        {interim && (
          <li className="opacity-60">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
              You
            </span>
            {interim}…
          </li>
        )}
      </ul>
    </div>
  );
}