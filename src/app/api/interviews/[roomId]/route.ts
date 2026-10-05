import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateRoomAccess } from "@/lib/interviews/interview.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";

type RouteParams = { params: Promise<{ roomId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;

  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const result = await validateRoomAccess(roomId);

  if (!result.ok) {
    return interviewErrorResponse(result.code, result.message);
  }

  return NextResponse.json({ room: result.room });
}