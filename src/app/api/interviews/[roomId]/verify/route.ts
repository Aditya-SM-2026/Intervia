import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import {
  activateRoom,
  verifyCandidateEmail,
} from "@/lib/interviews/interview.service";
import {
  roomIdSchema,
  verifyEmailSchema,
} from "@/lib/interviews/interview.validation";
import {
  checkEmailAttempt,
  recordEmailFailure,
  resetEmailAttempts,
} from "@/lib/interviews/email-attempts";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { generateLiveKitToken } from "@/lib/livekit/token";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * Candidate email gate: verifies the email matches the session and that
 * consent was given, then issues join credentials in the same response.
 * Failed attempts are rate-limited per link.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const attempt = checkEmailAttempt(roomId);
  if (!attempt.allowed) {
    return interviewErrorResponse(
      "EMAIL_MISMATCH",
      `Too many incorrect attempts. This link is locked for ${Math.ceil((attempt.retryAfterSeconds ?? 0) / 60)} more minutes.`,
    );
  }

  const result = await verifyCandidateEmail(roomId, parsed.data.email, new Date().toISOString());
  if (!result.ok) {
    if (result.code === "EMAIL_MISMATCH") recordEmailFailure(roomId);
    return interviewErrorResponse(result.code, result.message);
  }

  resetEmailAttempts(roomId);
  const identity = `candidate-${randomUUID()}`;
  const displayName = result.room.candidateName ?? "Candidate";

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