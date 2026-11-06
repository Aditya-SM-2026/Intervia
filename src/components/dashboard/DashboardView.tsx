"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Plus, SearchX, Trash2, TriangleAlert, X } from "lucide-react";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
import type { DashboardInterviewSummary, DashboardInterviewsResponse } from "@/lib/dashboard/dashboard.types";
import { ActivityStrip } from "./ActivityStrip";
import { EASE_OUT } from "@/components/ui/animated";
import { Toolbar, DEFAULT_RANGE } from "./Toolbar";
import { ReportsTable } from "./ReportsTable";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { exportReports } from "./export";

/**
 * Dashboard orchestrator: real-data analytics cards, filter toolbar,
 * server-paginated reports table, bulk selection + deletion, and the
 * confirmation flow. All numbers shown come from the API; trends and
 * sparklines are rendered only when the data supports them.
 */

const PAGE_SIZE = 10;
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
  const [role, setRole] = useState("");
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
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

  const hasActiveFilters = search !== "" || status !== "" || range !== DEFAULT_RANGE || role !== "";

  // Any filter change resets to the first page and clears page-scoped
  // selection (adjusted during render when the filter combination changes).
  const filterKey = `${search}|${status}|${range}|${role}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    setSelected(new Set());
  }

  const listKey = `${search}|${status}|${range}|${role}|${sortDir}|${page}|${reloadToken}`;
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const listLoading = list === null || loadedListKey !== listKey;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    if (role) params.set("role", role);
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
  }, [listKey, search, status, range, role, page]);

  // Role filter options come from the live roles list.
  useEffect(() => {
    fetch("/api/roles?")
      .then(async (response) => {
        if (!response.ok) throw new Error("roles request failed");
        return (await response.json()) as { roles: { title: string }[] };
      })
      .then((data) => {
        setRoleOptions([...new Set(data.roles.map((item) => item.title))]);
      })
      .catch(() => setRoleOptions([]));
  }, []);

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

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

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
    setRole("");
    setRange(DEFAULT_RANGE);
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
          body: JSON.stringify({ ids: roomIds }),
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

  function onRowAction(action: "view" | "download" | "edit" | "delete", roomId: string) {
    if (action === "view") {
      router.push(`/dashboard/${roomId}`);
      return;
    }
    if (action === "edit") {
      router.push(`/dashboard/${roomId}/edit`);
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

  const rows = list?.interviews ?? [];
  const emptyAfterFilters = !listLoading && listError === null && list !== null && list.total === 0 && hasActiveFilters;
  const nothingAtAll = !listLoading && listError === null && list !== null && list.total === 0 && !hasActiveFilters;
  const selectedCount = selected.size;

  return (
    <div className="grid gap-8">
      {analyticsError ? (
        <Notice tone="error" message={analyticsError} />
      ) : (
        <ActivityStrip analytics={analytics} />
      )}

      <section aria-label="Interviews" className="grid gap-4">
        <Toolbar
          search={searchInput}
          onSearchChange={setSearchInput}
          status={status}
          onStatusChange={setStatus}
          range={range}
          onRangeChange={setRange}
          roleOptions={roleOptions}
          role={role}
          onRoleChange={setRole}
          hasActiveFilters={hasActiveFilters}
          onClear={clearFilters}
          onExport={() => exportReports({ search, status, role, range })}
        />

        {listError ? (
          <EmptyState
            icon={<TriangleAlert className="size-5" aria-hidden />}
            title="The list didn't load"
            body="Check your connection, then try again."
            action={
              <button type="button" onClick={() => setReloadToken((token) => token + 1)} className={SECONDARY_BUTTON}>
                Try again
              </button>
            }
          />
        ) : emptyAfterFilters ? (
          <EmptyState
            icon={<SearchX className="size-5" aria-hidden />}
            title="No interviews match these filters"
            body="Try another name, status or date range."
            action={
              <button type="button" onClick={clearFilters} className={SECONDARY_BUTTON}>
                Reset filters
              </button>
            }
          />
        ) : nothingAtAll ? (
          <EmptyState
            icon={<Plus className="size-5" aria-hidden />}
            title="Your first interview starts here"
            body="Add a role and a candidate, then send them the link. The interview shows up here as soon as it's created."
            action={
              <Link href="/recruiter" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition hover:bg-accent/90">
                <Plus className="size-4" aria-hidden />
                New interview
              </Link>
            }
          />
        ) : (
          <div className="grid gap-2">
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
            {list && list.total > list.pageSize && (
              <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={gotoPage} />
            )}
            {list && list.total <= list.pageSize && list.total > 0 && (
              <p className="px-1 py-2 text-sm text-muted">
                {list.total} interview{list.total === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Bulk actions float above the page while rows are selected. */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            role="toolbar"
            aria-label="Bulk actions"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-1 rounded-2xl border border-border bg-surface/95 p-1.5 pl-4 shadow-2xl shadow-black/15 backdrop-blur-xl dark:shadow-black/50"
          >
            <p className="pr-3 text-sm font-medium tabular-nums">{selectedCount} selected</p>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="h-8 rounded-lg px-3 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setConfirmIds([...selected])}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result of a delete, bottom right; clears itself. */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-3.5 pr-2 shadow-xl shadow-black/10 dark:shadow-black/50"
          >
            {feedback.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
            )}
            <p className="text-sm">{feedback.message}</p>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Dismiss"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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

const SECONDARY_BUTTON =
  "inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]";

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-foreground/[0.05] text-muted">{icon}</span>
      <p className="mt-4 font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function Notice({ tone, message }: { tone: "error"; message: string }) {
  return (
    <p
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm ${
        tone === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" : ""
      }`}
    >
      {message}
    </p>
  );
}
