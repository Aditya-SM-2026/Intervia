import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { recordDecision } from "@/lib/interviews/interview.service";
import {
  decisionSchema,
  formatValidationIssues,
  roomIdSchema,
} from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

/** Records the recruiter's decision. The scorecard advises; a person decides. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return interviewErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", formatValidationIssues(parsed.error));
  }

  const room = await recordDecision(roomId, {
    ...parsed.data,
    decidedAt: new Date().toISOString(),
  });
  if (!room) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  return NextResponse.json({ decision: room.decision });
}
