"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pagination footer: visible range, total count, prev/next and numbered
 * pages with ellipses for large datasets. Server-side pagination — the
 * parent refetches on every page change.
 */

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

/** Numbered pages around the current one with leading/trailing ellipses. */
function pageItems(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push("…");
  for (let candidate = start; candidate <= end; candidate++) items.push(candidate);
  if (end < totalPages - 1) items.push("…");
  items.push(totalPages);
  return items;
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm">
      <p className="text-muted" aria-live="polite">
        Showing {from}–{to} of {total} results
      </p>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="grid size-8 place-items-center rounded-lg border border-border transition hover:bg-background disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        {pageItems(page, totalPages).map((item, index) =>
          item === "…" ? (
            <span key={`ellipsis-${index}`} className="px-1.5 text-muted" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPage(item)}
              aria-current={item === page ? "page" : undefined}
              className={`min-w-8 rounded-lg px-2 py-1.5 text-center text-sm font-medium transition ${
                item === page
                  ? "border border-accent bg-accent-soft text-accent"
                  : "border border-transparent text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="grid size-8 place-items-center rounded-lg border border-border transition hover:bg-background disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </nav>
    </div>
  );
}
