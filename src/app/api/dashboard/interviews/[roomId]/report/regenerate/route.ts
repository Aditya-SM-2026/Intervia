import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewReport } from "@/lib/interviews/report.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * Regenerates the report for one interview, overwriting the cached one.
 * Same response shape as GET …/report. If regeneration fails the previous
 * report (if any) stays cached and the reason is returned.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;

  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const outcome = await getInterviewReport(roomId, { force: true });

  if (outcome.ok) {
    return NextResponse.json(outcome.result);
  }

  return interviewErrorResponse(
    "ROOM_NOT_FOUND",
    "This interview does not exist. Ask your recruiter for the correct link.",
  );
}