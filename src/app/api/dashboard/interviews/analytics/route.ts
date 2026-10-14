import { NextResponse } from "next/server";
import { getDashboardAnalytics } from "@/lib/dashboard/dashboard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { DashboardAnalytics } from "@/lib/dashboard/dashboard.types";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Real-data analytics for the reports dashboard: totals, completion rate,
 * trends vs the previous 30 days, a 14-day series for the sparklines and
 * the recent sessions still awaiting analysis (the bell menu). Zero-arg GET.
 */
export async function GET() {
  const denied = await requireRecruiter();
  if (denied) return denied;

  try {
    const analytics: DashboardAnalytics = await getDashboardAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    console.error(`[dashboard] analytics failed: ${describeRoleError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not load the analytics. Please try again.",
    );
  }
}