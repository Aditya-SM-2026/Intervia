"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Clock3,
  FileCheck2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
import type { DashboardInterviewSummary, DashboardInterviewsResponse } from "@/lib/dashboard/dashboard.types";
import { MetricCard, type MetricCardData } from "./primitives";
import { Toolbar, DEFAULT_RANGE } from "./Toolbar";
import { ReportsTable } from "./ReportsTable";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Dashboard orchestrator: real-data analytics cards, filter toolbar,
 * server-paginated reports table, bulk selection + deletion, and the
 * confirmation flow. All numbers shown come from the API; trends and
 * sparklines are rendered only when the data supports them.
 */

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 300;

interface ListState {
  interviews: DashboardInterviewSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface Feedback {
  tone: "success" | "error";
  message: string;
}

export function DashboardView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [list, setList] = useState<ListState | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Global search (top navigation) writes ?q= — mirror it into the toolbar by
  // adjusting state during render when the URL query changes.
  const urlQuery = searchParams.get("q") ?? "";
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (lastUrlQuery !== urlQuery) {
    setLastUrlQuery(urlQuery);
    setSearchInput(urlQuery);
    setSearch(urlQuery);
  }

  // Debounce the toolbar search.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const hasActiveFilters = search !== "" || status !== "" || range !== "all";

  // Any filter change resets to the first page and clears page-scoped
  // selection (adjusted during render when the filter combination changes).
  const filterKey = `${search}|${status}|${range}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    setSelected(new Set());
  }

  const listKey = `${search}|${status}|${range}|${sortDir}|${page}|${reloadToken}`;
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const listLoading = list === null || loadedListKey !== listKey;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    if (range !== "all") params.set("range", range);
    params.set("sort", sortDir);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    fetch(`/api/dashboard/interviews?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("list request failed");
        return (await response.json()) as DashboardInterviewsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setList({ interviews: data.interviews, total: data.total, page: data.page, pageSize: data.pageSize });
        setListError(null);
        setLoadedListKey(listKey);
      })
      .catch(() => {
        if (!cancelled) setListError("Could not load the interview list. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [listKey, search, status, range, sortDir, page]);

  const fetchAnalytics = useCallback(() => {
    fetch("/api/dashboard/interviews/analytics")
      .then(async (response) => {
        if (!response.ok) throw new Error("analytics request failed");
        return (await response.json()) as DashboardAnalytics;
      })
      .then((data) => {
        setAnalytics(data);
        setAnalyticsError(null);
      })
      .catch(() => setAnalyticsError("Could not load the analytics. Please try again."));
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  function toggleRow(roomId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  function toggleAll() {
    if (!list) return;
    const pageIds = list.interviews.map((row) => row.room.id);
    const allSelected = pageIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(pageIds));
  }

  function gotoPage(next: number) {
    setPage(next);
    setSelected(new Set());
  }

  function toggleSort() {
    setSortDir((current) => (current === "desc" ? "asc" : "desc"));
    setSelected(new Set());
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setRange("all");
  }

  /** Page adjustment when a page loses every row; returns the page to load. */
  function pageAfterRemoval(remainingTotal: number): number {
    if (!list) return page;
    const maxPage = Math.max(1, Math.ceil(remainingTotal / list.pageSize));
    return Math.min(page, maxPage);
  }

  function refreshAfterDeletion(remainingTotal: number) {
    const nextPage = pageAfterRemoval(remainingTotal);
    if (nextPage !== page) setPage(nextPage);
    setReloadToken((token) => token + 1);
  }

  function runDeletion(roomIds: string[]) {
    setDeleting(true);
    const bulk = roomIds.length > 1;
    const request = bulk
      ? fetch("/api/dashboard/interviews/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomIds }),
        }).then(async (response) => {
          if (!response.ok && response.status !== 200) throw new Error("bulk delete failed");
          return (await response.json()) as { deleted: string[]; failed: { roomId: string; error: string }[] };
        })
      : fetch(`/api/dashboard/interviews/${roomIds[0]}`, { method: "DELETE" }).then(async (response) => {
          if (!response.ok) throw new Error("delete failed");
          return { deleted: [roomIds[0]], failed: [] as { roomId: string; error: string }[] };
        });

    request
      .then((result) => {
        const remainingTotal = (list?.total ?? 0) - result.deleted.length;
        refreshAfterDeletion(remainingTotal);
        // Keep only rows that failed (and still exist) selected for retry.
        setSelected(new Set(result.failed.map((item) => item.roomId)));
        if (result.failed.length === 0) {
          setFeedback({
            tone: "success",
            message: `Deleted ${result.deleted.length} interview${result.deleted.length === 1 ? "" : "s"}.`,
          });
        } else {
          setFeedback({
            tone: "error",
            message: `${result.failed.length} of ${roomIds.length} interview${roomIds.length === 1 ? "" : "s"} could not be deleted — they stay selected. ${result.failed[0].error}`,
          });
        }
      })
      .catch(() =>
        setFeedback({ tone: "error", message: "Deletion failed. Please try again." }),
      )
      .finally(() => {
        setDeleting(false);
        setConfirmIds(null);
      });
  }

  function onRowAction(action: "view" | "download" | "delete", roomId: string) {
    if (action === "view") {
      router.push(`/dashboard/${roomId}`);
      return;
    }
    if (action === "download") {
      // Programmatic anchor: the endpoint answers with an attachment, which
      // router navigation would not trigger a download for.
      const link = document.createElement("a");
      link.href = `/api/dashboard/interviews/${roomId}/report/download`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    setConfirmIds([roomId]);
  }

  const cards = useMemo<MetricCardData[]>(() => {
    const interviewSeries = analytics?.series.map((point) => point.interviews) ?? undefined;
    const reportSeries = analytics?.series.map((point) => point.reports) ?? undefined;
    return [
      {
        label: "Total interviews",
        value: analytics ? String(analytics.total) : "—",
        icon: <Users className="size-5" aria-hidden />,
        iconClasses: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
        trend: analytics?.trends.total ?? null,
        trendLabel: "vs previous 30 days",
        series: interviewSeries,
        seriesColor: { stroke: "#2563eb", fill: "#3b82f6" },
      },
      {
        label: "Reports ready",
        value: analytics ? String(analytics.reportsReady) : "—",
        icon: <FileCheck2 className="size-5" aria-hidden />,
        iconClasses: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
        trend: analytics?.trends.reportsReady ?? null,
        trendLabel: "vs previous 30 days",
        series: reportSeries,
        seriesColor: { stroke: "#10b981", fill: "#34d399" },
      },
      {
        label: "Awaiting analysis",
        value: analytics ? String(analytics.awaitingAnalysis) : "—",
        icon: <Clock3 className="size-5" aria-hidden />,
        iconClasses: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
        trend: analytics?.trends.awaitingAnalysis ?? null,
        trendLabel: "vs previous 30 days",
      },
      {
        label: "Completion rate",
        value: analytics ? `${analytics.completionRate}%` : "—",
        icon: <Activity className="size-5" aria-hidden />,
        iconClasses: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
        trend: analytics?.trends.completionRate ?? null,
        trendUnit: "pp",
        trendLabel: "vs previous 30 days",
      },
    ];
  }, [analytics]);

  const rows = list?.interviews ?? [];
  const emptyAfterFilters = !listLoading && listError === null && list !== null && list.total === 0 && hasActiveFilters;
  const nothingAtAll = !listLoading && listError === null && list !== null && list.total === 0 && !hasActiveFilters;
  const selectedCount = selected.size;

  return (
    <div className="grid gap-6">
      <section aria-label="Analytics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {analytics === null && analyticsError === null
          ? Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-[110px] animate-pulse rounded-2xl border border-border bg-surface" aria-hidden />
            ))
          : cards.map((card) => <MetricCard key={card.label} data={card} />)}
        {analyticsError && (
          <p role="alert" className="sm:col-span-2 xl:col-span-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {analyticsError}
          </p>
        )}
      </section>

      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
            className="rounded-md p-1 transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <Toolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        status={status}
        onStatusChange={setStatus}
        range={range}
        onRangeChange={setRange}
        hasActiveFilters={hasActiveFilters}
        onClear={clearFilters}
      />

      {selectedCount > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3"
        >
          <p className="text-sm font-medium">
            {selectedCount} interview{selectedCount === 1 ? "" : "s"} selected on this page
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium transition hover:bg-background"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => setConfirmIds([...selected])}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-red-700"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete selected
            </button>
          </div>
        </div>
      )}

      {listError ? (
        <div className="grid gap-3">
          <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {listError}
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="justify-self-start rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
          >
            Retry
          </button>
        </div>
      ) : emptyAfterFilters ? (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
          <p className="font-medium">No interviews match your filters</p>
          <p className="mt-1 text-sm text-muted">Try a different search term, status or date range.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-background"
          >
            Clear filters
          </button>
        </div>
      ) : nothingAtAll ? (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
          <p className="font-medium">No interviews yet</p>
          <p className="mt-1 text-sm text-muted">
            Create an interview and share the link — it appears here as soon as it exists.
          </p>
          <Link
            href="/recruiter"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Create an interview
          </Link>
        </div>
      ) : (
        <>
          <ReportsTable
            rows={rows}
            loading={listLoading && rows.length === 0}
            skeletonCount={PAGE_SIZE}
            selected={selected}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            sortDir={sortDir}
            onSortToggle={toggleSort}
            onAction={onRowAction}
          />
          {list && (
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              onPage={gotoPage}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmIds !== null}
        busy={deleting}
        title={confirmIds !== null && confirmIds.length > 1 ? `Delete ${confirmIds.length} interviews?` : "Delete interview?"}
        body={
          <>
            This permanently removes{" "}
            {confirmIds !== null && confirmIds.length > 1
              ? `${confirmIds.length} interviews`
              : "this interview"}{" "}
            including the transcript and report. This cannot be undone.
          </>
        }
        confirmLabel={confirmIds !== null && confirmIds.length > 1 ? `Delete ${confirmIds.length} interviews` : "Delete interview"}
        onConfirm={() => confirmIds && runDeletion(confirmIds)}
        onCancel={() => {
          if (!deleting) setConfirmIds(null);
        }}
      />
    </div>
  );
}
