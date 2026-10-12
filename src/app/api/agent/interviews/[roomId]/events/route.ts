import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import {
  agentEventsSchema,
  formatValidationIssues,
  roomIdSchema,
} from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

/** Appends a batch of transcript turns and log events from the agent worker. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = requireAgent(request);
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid interview id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return interviewErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }
  const parsed = agentEventsSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", formatValidationIssues(parsed.error));
  }

  const repository = getInterviewRepository();
  if (!(await repository.get(roomId))) {
    return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");
  }

  await repository.appendTurns(roomId, parsed.data.turns);
  await repository.appendEvents(roomId, parsed.data.events);
  return NextResponse.json({ ok: true });
}
