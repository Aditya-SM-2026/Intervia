import type { InterviewRoom, InterviewStatus } from "@/lib/interviews/interview.types";
import type { ScorecardSummary } from "@/lib/interviews/scorecard.types";

/**
 * Types for the recruiter reports dashboard: the server-paginated list,
 * real-data analytics and the row summary shape shared by the API and UI.
 * All numbers are computed from stored rows; trends are null when the
 * previous period has no data, so no invented percentages are shown.
 */

/** State of the report column for one interview. */
export type ReportState = "ready" | "processing" | "not-started";

/** Filters/sorting/pagination for the dashboard list. */
export interface DashboardListFilter {
  /** Case-insensitive substring across candidate, role, recruiter, title, email. */
  search?: string;
  /** Session status filter. */
  status?: InterviewStatus;
  /** Only sessions created at or after this ISO timestamp. */
  from?: string;
  /** Only sessions created before this ISO timestamp. */
  to?: string;
  /** Sort direction on created_at (default: desc). */
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** One dashboard row: the session plus its scorecard summary, if scored. */
export interface DashboardInterviewSummary {
  room: InterviewRoom;
  scorecard: ScorecardSummary | null;
  /** Report column state, derived from status + scorecard presence. */
  reportState: ReportState;
  /** One-line reason shown under the report state when not ready. */
  reportReason: string | null;
}

/** Shape of GET /api/dashboard/interviews — one server-paginated page. */
export interface DashboardInterviewsResponse {
  interviews: DashboardInterviewSummary[];
  /** Total count across all pages for the current filter. */
  total: number;
  page: number;
  pageSize: number;
}

/** Recent sessions still waiting for their scorecard — drives the bell menu. */
export interface DashboardAwaitingItem {
  roomId: string;
  candidateName: string | null;
  roleTitle: string | null;
  /** ISO 8601 — completion time when known, else creation time. */
  at: string;
}

export interface DashboardAnalytics {
  total: number;
  reportsReady: number;
  awaitingAnalysis: number;
  /** reportsReady / total, 0-100 rounded; 0 when there are no sessions. */
  completionRate: number;
  trends: {
    total: number | null;
    reportsReady: number | null;
    awaitingAnalysis: number | null;
    completionRate: number | null;
  };
  /** Genuine per-day counts for the last 14 days. */
  series: { date: string; interviews: number; reports: number }[];
  awaitingRecent: DashboardAwaitingItem[];
}