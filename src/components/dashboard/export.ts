"use client";

/**
 * Downloads the full CSV of every dashboard report matching the current
 * filters. The API answers with an attachment, so a programmatic anchor is
 * used (router navigation would not trigger a download).
 */
export function exportReports(filters: { search: string; status: string; role: string; range: string }) {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.role) params.set("role", filters.role);
  if (filters.range !== "all") params.set("range", filters.range);
  const link = document.createElement("a");
  link.href = `/api/dashboard/interviews/export${params.toString() ? `?${params.toString()}` : ""}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}