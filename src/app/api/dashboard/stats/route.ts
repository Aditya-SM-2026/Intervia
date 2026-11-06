import { NextResponse, type NextRequest } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { StatsRange } from "@/lib/dashboard/stats.types";
import { readDashboardStats } from "@/server/repositories/stats-repository";

const RANGES: StatsRange[] = ["30", "90", "365", "all"];

/** Stats page data: hiring funnel, per-role numbers, scores and AI cost. */
export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const raw = request.nextUrl.searchParams.get("range");
  const range: StatsRange = RANGES.includes(raw as StatsRange) ? (raw as StatsRange) : "90";
  try {
    return NextResponse.json(await readDashboardStats(range));
  } catch (error) {
    console.error(`[dashboard] stats failed: ${describeRoleError(error)}`);
    return interviewErrorResponse("SERVER_ERROR", "Could not load the stats. Please try again.");
  }
}
