import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  countDashboardInterviews,
  listDashboardInterviews,
} from "@/lib/interviews/interview.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import type { DashboardInterviewsResponse } from "@/lib/interviews/report.types";
import type { InterviewStatus, ReportState } from "@/lib/interviews/interview.types";

/**
 * Recruiter dashboard list — server-side filtering, sorting and pagination.
 * Access follows the existing pattern of this code base (room access
 * validation, no recruiter accounts yet), so this endpoint is as protected as
 * every other recruiter route today.
 *
 * Query params: `q` (substring across candidate, role, recruiter, title),
 * `status`, `report` (ready|processing|not-started), `range` (7|30|90|all
 * days back from now), `sort` (asc|desc on creation date), `page`, `pageSize`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page")) ?? 1;
  const pageSize = Math.min(parsePositiveInt(params.get("pageSize")) ?? 8, 50);

  try {
    const filter = {
      search: params.get("q") ?? undefined,
      status: parseEnum<InterviewStatus>(params.get("status"), [
        "scheduled", "waiting", "active", "completed", "expired", "cancelled",
      ]),
      reportState: parseEnum<ReportState>(params.get("report"), ["ready", "processing", "not-started"]),
      from: parseFrom(params.get("range")),
      sortDir: params.get("sort") === "asc" ? ("asc" as const) : ("desc" as const),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    const [interviews, total] = await Promise.all([
      listDashboardInterviews(filter),
      countDashboardInterviews(filter),
    ]);
    const body: DashboardInterviewsResponse = { interviews, total, page, pageSize };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[dashboard] list failed: ${describeError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not load the interview list. Please try again.",
    );
  }
}

function parseFrom(range: string | null): string | undefined {
  if (range === null || range === "all" || range.trim() === "") return undefined;
  const days = Number.parseInt(range, 10);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseEnum<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}