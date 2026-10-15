import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listDashboardInterviews } from "@/lib/dashboard/dashboard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { DashboardInterviewsResponse } from "@/lib/dashboard/dashboard.types";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Recruiter reports dashboard list (signed-in recruiters only).
 *
 * Query params: `q` (search across candidate, role, recruiter, title, email),
 * `email` (legacy candidate-email substring filter), `status`, `range`
 * (7d|30d|all), `sort` (asc|desc on creation time), `page`, `pageSize`.
 * Server-side pagination: the response carries the total across all pages.
 */

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30 };

export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;

  const search = params.get("q") ?? undefined;
  const email = params.get("email") ?? undefined;
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
  const pageSize = Math.min(Math.max(parsePositiveInt(params.get("pageSize")) ?? 10, 1), 50);
  const page = Math.max(parsePositiveInt(params.get("page")) ?? 1, 1);

  try {
    const response = await listDashboardInterviews({
      search: search || email || undefined,
      status,
      roleTitle,
      from,
      sortDir,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const body: DashboardInterviewsResponse = response;
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[dashboard] list failed: ${describeRoleError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not load the interview list. Please try again.",
    );
  }
}

function parsePositiveInt(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}