import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { recordSessionOutcome } from "@/lib/interviews/interview.service";
import {
  agentCompleteSchema,
  formatValidationIssues,
  roomIdSchema,
} from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { enqueueJob } from "@/lib/jobs/queue";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * The agent worker reports that the live interview has ended. The outcome is
 * stored and the scorecard and mixed recording are queued as jobs, so the
 * worker is never held up by them.
 */
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
  const parsed = agentCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", formatValidationIssues(parsed.error));
  }

  const { completed, ...outcome } = parsed.data;
  const room = await recordSessionOutcome(roomId, outcome, completed);
  if (!room) return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");

  if (room.status === "completed") {
    // Two separate jobs, so a mix failure never blocks or re-runs the
    // scorecard. Queued before replying; the work itself runs as its own
    // request with full CPU.
    await Promise.allSettled([
      enqueueJob({ kind: "score-interview", roomId }),
      enqueueJob({ kind: "mix-recording", roomId }),
    ]);
  }
  return NextResponse.json({ ok: true, status: room.status });
}
