import { NextResponse } from "next/server";
import { getDashboardAnalytics } from "@/lib/interviews/interview.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import type { DashboardAnalytics } from "@/lib/interviews/interview.types";

/**
 * Real-data analytics for the dashboard metric cards, the bell menu and the
 * sparklines. Trends compare the last 30 days with the previous 30 and are
 * null whenever the earlier period has no data — no invented percentages.
 */
export async function GET() {
  try {
    const analytics: DashboardAnalytics = await getDashboardAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    console.error(`[dashboard] analytics failed: ${describeError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not load the dashboard analytics. Please try again.",
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}