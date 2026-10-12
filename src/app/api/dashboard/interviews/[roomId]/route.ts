import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { getInterviewDetail } from "@/lib/interviews/scorecard.service";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * One interview for the recruiter: session, plan, transcript, event log and
 * scorecard in a single response. The scorecard is normally ready (it is
 * generated when the interview ends); if it is missing it is generated here.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const detail = await getInterviewDetail(roomId);
  if (!detail) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  return NextResponse.json(detail);
}
