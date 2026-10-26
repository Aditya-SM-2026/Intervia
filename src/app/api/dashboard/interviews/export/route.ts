import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { listDashboardInterviews } from "@/lib/dashboard/dashboard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { InterviewStatus } from "@/lib/interviews/interview.types";

/**
 * CSV export of every interview report on the dashboard, honouring the same
 * filters as the list endpoint (search, status, role, date range, sort) so
 * what the recruiter sees on screen is what gets downloaded — all pages,
 * not just the one in view. Pending/unscored rows are labelled, never
 * invented, and each row links back to its full report.
 */

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "7d": 7, "30d": 30 };
const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Scheduled",
  waiting: "Waiting",
  active: "Active",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const SUGGESTION_LABELS: Record<string, string> = {
  strong: "Strong",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Insufficient",
};

export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const search = params.get("q") ?? undefined;
  const statusRaw = params.get("status");
  const status =
    statusRaw &&
    ["scheduled", "waiting", "active", "completed", "expired", "cancelled"].includes(statusRaw)
      ? (statusRaw as InterviewStatus)
      : undefined;
  const roleTitle = params.get("role") ?? undefined;
  const range = params.get("range");
  const rangeDays = range && range !== "all" ? RANGE_DAYS[range] : undefined;
  const from = rangeDays
    ? new Date(Date.now() - rangeDays * 24 * 3600 * 1000).toISOString()
    : undefined;
  const sortDir = params.get("sort") === "asc" ? "asc" : "desc";
  const origin = request.nextUrl.origin;

  try {
    // Page through the full (filtered) list; the list endpoint is paginated.
    const rows: Awaited<ReturnType<typeof listDashboardInterviews>>["interviews"] = [];
    let total = Infinity;
    for (let offset = 0; offset < rows.length || rows.length < total; offset += PAGE_SIZE) {
      if (rows.length >= MAX_ROWS) break;
      const page = await listDashboardInterviews({
        search: search || undefined,
        status,
        roleTitle,
        from,
        sortDir,
        limit: PAGE_SIZE,
        offset,
      });
      total = page.total;
      rows.push(...page.interviews);
      if (page.interviews.length === 0) break;
    }

    const header = [
      "Candidate",
      "Email",
      "Role",
      "Status",
      "Report",
      "Overall score",
      "Suggestion",
      "Decision",
      "Created",
      "Completed",
      "Report link",
    ];
    const lines = [header.join(",")];
    for (const { room, scorecard, reportState } of rows) {
      const report =
        reportState === "ready"
          ? "Ready"
          : reportState === "processing"
            ? "Processing"
            : "Not started";
      lines.push(
        [
          room.candidateName ?? "",
          room.candidateEmail ?? "",
          room.roleTitle ?? room.title,
          STATUS_LABELS[room.status],
          report,
          scorecard?.overall?.score ?? (reportState === "ready" ? scorecard?.overallScore ?? "" : ""),
          reportState === "ready" && scorecard
            ? SUGGESTION_LABELS[scorecard.suggestion] ?? scorecard.suggestion
            : "",
          room.decision?.outcome ?? "",
          room.createdAt,
          room.completedAt ?? "",
          `${origin}/dashboard/${room.id}`,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(`\uFEFF${lines.join("\r\n")}\r\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sreemedhas-reports-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[dashboard] export failed: ${describeRoleError(error)}`);
    return interviewErrorResponse("SERVER_ERROR", "Could not export the reports. Please try again.");
  }
}