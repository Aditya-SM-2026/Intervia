import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { getInterviewDetail } from "@/lib/interviews/scorecard.service";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * Re-scores an interview from its stored transcript. If the new run fails the
 * previous scorecard is kept and the reason is returned alongside it.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const detail = await getInterviewDetail(roomId, { force: true });
  if (!detail) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  return NextResponse.json(detail);
}
