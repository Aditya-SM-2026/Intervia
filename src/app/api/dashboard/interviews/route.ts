import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listDashboardInterviews } from "@/lib/interviews/interview.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import type { DashboardInterviewsResponse } from "@/lib/interviews/scorecard.types";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Recruiter dashboard list (signed-in recruiters only).
 *
 * Query params: `email` (case-insensitive substring filter on the candidate
 * email), `limit`, `offset`.
 */
export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const email = request.nextUrl.searchParams.get("email") ?? undefined;
  const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"));
  const offset = parsePositiveInt(request.nextUrl.searchParams.get("offset"));

  try {
    const interviews = await listDashboardInterviews({ email, limit, offset });
    const body: DashboardInterviewsResponse = { interviews };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[dashboard] list failed: ${describeError(error)}`);
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}