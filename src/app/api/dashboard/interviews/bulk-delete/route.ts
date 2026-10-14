import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDashboardInterviews } from "@/lib/dashboard/dashboard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Bulk delete of interview sessions and every child row (turns, events,
 * scorecards). Per-room transactions: one failure never blocks the others,
 * and the response reports exactly what succeeded and what failed.
 */

const bulkDeleteSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1, "Provide at least one interview to delete.")
      .max(100, "Delete at most 100 interviews at a time."),
  });

export async function POST(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return interviewErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }

  const parsed = bulkDeleteSchema.safeParse(payload);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", "Provide 1-100 interview ids to delete.");
  }

  try {
    const result = await deleteDashboardInterviews(parsed.data.ids);
    return NextResponse.json({ deleted: result.deleted, failed: result.failed });
  } catch (error) {
    console.error(`[dashboard] bulk delete failed: ${describeRoleError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not delete the selected interviews. Please try again.",
    );
  }
}