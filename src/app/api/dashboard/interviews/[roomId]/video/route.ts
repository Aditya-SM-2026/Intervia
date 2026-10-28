import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { requestVideoAnalysis } from "@/lib/interviews/scorecard.service";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * The recruiter's override for the transcript gate: analyse this interview's
 * recording even though the automatic run skipped or failed it. The job goes
 * to the analysis worker and the result arrives through the usual callback.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const outcome = await requestVideoAnalysis(roomId);
  if (!outcome.queued) {
    return interviewErrorResponse(outcome.code, outcome.reason);
  }
  return NextResponse.json({ status: "queued" }, { status: 202 });
}
