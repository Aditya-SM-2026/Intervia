import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { requestResumeAnalysis } from "@/lib/interviews/scorecard.service";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * The recruiter's override for the transcript gate on the resume side: check
 * this candidate's resume against their answers even though the automatic run
 * skipped or failed it. Only the resume factor changes, and the weighted total
 * is recomputed so the average at the top follows it.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const outcome = await requestResumeAnalysis(roomId);
  if (!outcome.ok) {
    return interviewErrorResponse(outcome.code, outcome.reason);
  }
  return NextResponse.json({ ok: true, score: outcome.score, reason: outcome.reason });
}
