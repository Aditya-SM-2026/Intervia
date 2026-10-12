import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { deleteInterviewSession } from "@/lib/interviews/interview.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * Permanently deletes an interview session with its transcript turns and its
 * report. Irreversible — the dashboard asks for confirmation first.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;

  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const deleted = await deleteInterviewSession(roomId);

  if (!deleted) {
    return interviewErrorResponse(
      "ROOM_NOT_FOUND",
      "This interview does not exist. Ask your recruiter for the correct link.",
    );
  }

  return NextResponse.json({ ok: true });
}