"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { parseDocument, type DocumentBlock } from "@/lib/text/document-blocks";

/**
 * Renders pasted text (job descriptions, notes) as a readable document:
 * headings, short paragraphs, lists and a facts table, set at a comfortable
 * measure. With `collapsedHeight`, long documents start folded under a fade.
 */
export function DocumentText({
  text,
  collapsedHeight,
  hideFactLabels = [],
  className,
  onDark = false,
}: {
  text: string;
  collapsedHeight?: number;
  /** Facts already shown elsewhere on the page (e.g. in the header). */
  hideFactLabels?: string[];
  className?: string;
  /** Light type and rules, for a document placed on a dark panel. */
  onDark?: boolean;
}) {
  const blocks = useMemo(() => parseDocument(text), [text]);
  const [open, setOpen] = useState(false);
  const hidden = new Set(hideFactLabels.map((label) => label.toLowerCase()));
  const long = collapsedHeight !== undefined && text.length > 700;

  return (
    <div className={className}>
      <div
        className="relative overflow-hidden"
        style={long && !open ? { maxHeight: collapsedHeight } : undefined}
      >
        <div
          className={`max-w-[68ch] space-y-4 text-[15px] leading-7 ${
            onDark ? "text-white/70" : "text-foreground/85"
          }`}
        >
          {blocks.map((block, index) => (
            <Block key={index} block={block} first={index === 0} hidden={hidden} onDark={onDark} />
          ))}
        </div>
        {long && !open && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t to-transparent ${
              onDark ? "from-[#081a3d]" : "from-surface"
            }`}
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className={`mt-3 inline-flex items-center gap-1.5 text-sm font-medium transition ${
            onDark ? "text-white/85 hover:text-white" : "text-accent hover:text-accent/80"
          }`}
        >
          {open ? "Show less" : "Read the full description"}
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
    </div>
  );
}

function Block({
  block,
  first,
  hidden,
  onDark,
}: {
  block: DocumentBlock;
  first: boolean;
  hidden: Set<string>;
  onDark: boolean;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <h3
          className={`text-[15px] font-semibold leading-6 ${onDark ? "text-white" : "text-foreground"} ${
            first ? "" : "pt-3"
          }`}
        >
          {block.text}
        </h3>
      );
    case "paragraph":
      return <p>{block.text}</p>;
    case "bullets":
      return (
        <ul className="space-y-2">
          {block.items.map((item, index) => (
            <li key={index} className="relative pl-5">
              <span
                aria-hidden
                className={`absolute left-1 top-[0.7em] size-1.5 rounded-full ${
                  onDark ? "bg-white/40" : "bg-accent/60"
                }`}
              />
              {item}
            </li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol className="space-y-2">
          {block.items.map((item, index) => (
            <li key={index} className="grid grid-cols-[1.75rem_1fr]">
              <span
                className={`text-sm font-medium tabular-nums ${onDark ? "text-white/45" : "text-muted"}`}
              >
                {item.n}.
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      );
    case "facts": {
      const items = block.items.filter((item) => !hidden.has(item.label.toLowerCase()));
      if (items.length === 0) return null;
      return (
        <dl
          className={`grid gap-x-6 gap-y-2 rounded-xl px-4 py-3 text-sm sm:grid-cols-[max-content_1fr] ${
            onDark ? "bg-white/[0.06]" : "bg-foreground/[0.03]"
          }`}
        >
          {items.map((item, index) => (
            <div key={index} className="contents">
              <dt className={onDark ? "text-white/50" : "text-muted"}>{item.label}</dt>
              <dd className={`font-medium ${onDark ? "text-white" : "text-foreground"}`}>{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }
}
