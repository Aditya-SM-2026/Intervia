import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewReport } from "@/lib/interviews/report.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * The report for one interview, with the session and the pipeline's
 * transcript turns so the UI can render everything from one response.
 * Generated lazily on the first view and cached afterwards; missing or
 * legacy reports come back as `report: null` with a reason, never as a 500.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;

  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const outcome = await getInterviewReport(roomId);

  if (outcome.ok) {
    return NextResponse.json(outcome.result);
  }

  return interviewErrorResponse(
    "ROOM_NOT_FOUND",
    "This interview does not exist. Ask your recruiter for the correct link.",
  );
}