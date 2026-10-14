import "server-only";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import type {
  DashboardAnalytics,
  DashboardInterviewSummary,
  DashboardInterviewsResponse,
  DashboardListFilter,
  ReportState,
} from "@/lib/dashboard/dashboard.types";
import {
  getDashboardRepository,
  type DashboardRow,
} from "@/server/repositories/dashboard-repository";
import { getInterviewRepository } from "@/server/repositories";

/**
 * Reports dashboard business logic on top of the dashboard repository and
 * the existing interview repository (scorecard summaries). The report
 * column is honest: it reflects what actually exists for each session.
 */

function reportStateFor(
  status: string,
  hasScorecard: boolean,
): { reportState: ReportState; reportReason: string | null } {
  if (hasScorecard) return { reportState: "ready", reportReason: null };
  const normalized = status as InterviewStatus;
  switch (normalized) {
    case "active":
      return { reportState: "processing", reportReason: "Interview in progress" };
    case "waiting":
      return { reportState: "processing", reportReason: "Candidate joining" };
    case "completed":
      // v2 generates the scorecard when the interview ends; a missing one on
      // a completed session opens (and generates) on first view.
      return {
        reportState: "processing",
        reportReason: "Awaiting analysis — opens on first view",
      };
    case "scheduled":
      return { reportState: "not-started", reportReason: "Not started" };
    case "expired":
      return { reportState: "not-started", reportReason: "Never joined" };
    case "cancelled":
      return { reportState: "not-started", reportReason: "Cancelled" };
    default:
      return { reportState: "not-started", reportReason: null };
  }
}

function toSummary(row: DashboardRow, scorecard: DashboardInterviewSummary["scorecard"]): DashboardInterviewSummary {
  const { reportState, reportReason } = reportStateFor(row.room.status, row.hasScorecard);
  return {
    room: {
      ...row.room,
      status: row.room.status as InterviewStatus,
    } as DashboardInterviewSummary["room"],
    scorecard,
    reportState,
    reportReason,
  };
}

export async function listDashboardInterviews(
  filter: DashboardListFilter,
): Promise<DashboardInterviewsResponse> {
  const limit = filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 50) : 10;
  const page = Math.max(1, Math.floor(filter.offset ?? 0) / limit + 1);
  const repository = getDashboardRepository();
  const { rows, total } = await repository.list({ ...filter, limit, offset: (page - 1) * limit });
  const interviewRepository = getInterviewRepository();
  const summaries = await interviewRepository.getScorecardSummaries(rows.map((row) => row.room.id));
  return {
    interviews: rows.map((row) => toSummary(row, summaries.get(row.room.id) ?? null)),
    total,
    page,
    pageSize: limit,
  };
}

export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  return getDashboardRepository().getAnalytics();
}

export async function deleteDashboardInterviews(
  roomIds: readonly string[],
): Promise<{ deleted: string[]; failed: { roomId: string; error: string }[] }> {
  return getDashboardRepository().deleteSessions(roomIds);
}