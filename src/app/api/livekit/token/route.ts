import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { activateRoom, validateRoomAccess } from "@/lib/interviews/interview.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { generateLiveKitToken } from "@/lib/livekit/token";

const bodySchema = z.object({ roomId: roomIdSchema });

/**
 * Issues LiveKit join credentials for a candidate.
 * - The room is validated server-side (existing, not expired, not cancelled).
 * - The participant identity is generated here; client-provided values are
 *   never trusted for identity.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return interviewErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const { roomId } = parsed.data;
  const access = await validateRoomAccess(roomId);
  if (!access.ok) {
    return interviewErrorResponse(access.code, access.message);
  }

  const identity = `candidate-${randomUUID()}`;
  const displayName = access.room.candidateName ?? "Candidate";

  try {
    const credentials = await generateLiveKitToken({
      roomName: getLiveKitRoomName(roomId),
      identity,
      displayName,
    });
    await activateRoom(roomId);
    return NextResponse.json({ ...credentials, identity });
  } catch (error) {
    console.error("LiveKit token generation failed:", error);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "The interview room is not available right now. Please try again shortly.",
    );
  }
}