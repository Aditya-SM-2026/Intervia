import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteInterviewSessions } from "@/lib/interviews/interview.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

/**
 * Bulk delete for the dashboard's multi-select. Takes up to 100 room ids,
 * deletes each through the transactional single-delete path, and reports
 * exactly which succeeded and which failed so the UI can keep failed rows
 * selected for retry.
 */
const bulkDeleteSchema = z.object({
  roomIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return interviewErrorResponse("INVALID_INPUT", "Expected a JSON body with roomIds.");
  }

  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse(
      "INVALID_INPUT",
      "roomIds must be an array of 1-100 interview ids.",
    );
  }

  try {
    const result = await deleteInterviewSessions(parsed.data.roomIds);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[dashboard] bulk delete failed: ${describeError(error)}`);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "Could not delete the selected interviews. Please try again.",
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}