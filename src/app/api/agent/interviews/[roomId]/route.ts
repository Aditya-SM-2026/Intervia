import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { getInterviewRoom } from "@/lib/interviews/interview.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * What the agent worker needs to run one interview: logistics and the plan.
 * Rating anchors are deliberately left out — the live interviewer gathers
 * evidence and must not grade, so it never sees the rubric.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = requireAgent(request);
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid interview id.");
  }

  const room = await getInterviewRoom(roomId);
  if (!room) return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");

  return NextResponse.json({
    interview: {
      id: room.id,
      roleTitle: room.roleTitle ?? room.title,
      candidateName: room.candidateName,
      recruiterName: room.recruiterName,
      durationMinutes: room.durationMinutes,
      difficulty: room.difficulty,
      voiceMode: room.voiceMode,
    },
    plan: room.plan
      ? {
          roleSummary: room.plan.roleSummary,
          candidateSummary: room.plan.candidateSummary,
          competencies: room.plan.competencies.map((competency) => ({
            id: competency.id,
            name: competency.name,
            description: competency.description,
            question: competency.question,
            followUps: competency.followUps,
            lookFor: competency.lookFor,
            resumeProbe: competency.resumeProbe,
            minutes: competency.minutes,
          })),
        }
      : null,
  });
}
