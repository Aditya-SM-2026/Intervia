import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { validateRoomAccess } from "@/lib/interviews/interview.service";
import { hrJoinSchema, roomIdSchema } from "@/lib/interviews/interview.validation";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { generateLiveKitToken } from "@/lib/livekit/token";
import { reconnectStateFor } from "@/lib/interviews/reconnect.service";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

function tokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * HR link: the recruiter issued a token for this interview, and it is the only
 * credential needed. HR joins as a normal participant ("hr-..." identity) so
 * they can listen to the whole interview and speak to the candidate.
 *
 * Deliberately no `participant`/dispatch here: the agent is dispatched by the
 * candidate's token. If HR arrives first they simply wait; the agent waits for
 * the candidate and links to them only.
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
  const parsed = hrJoinSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const access = await validateRoomAccess(roomId);
  if (!access.ok) {
    return interviewErrorResponse(access.code, access.message);
  }
  if (!access.room.hrToken || !tokenMatches(access.room.hrToken, parsed.data.token)) {
    return interviewErrorResponse(
      "ROOM_NOT_FOUND",
      "This HR link is not valid for this interview. Ask the recruiter for a new link.",
    );
  }

  const identity = `hr-${randomUUID()}`;
  try {
    // The interview clock is shared, not restarted when HR joins: the same
    // event log the candidate's rejoin gate reads says how much time is left.
    const repository = getInterviewRepository();
    const events = await repository.getEvents(roomId);
    const clock = reconnectStateFor(access.room, events);
    const credentials = await generateLiveKitToken({
      roomName: getLiveKitRoomName(roomId),
      identity,
      displayName: "HR",
      // Publishing is on: HR speaks to the candidate. The agent never listens
      // to them, it only steps aside while they talk.
      canPublish: true,
    });
    await repository.appendEvents(roomId, [
      { type: "hr_joined", at: new Date().toISOString(), data: { identity } },
    ]);
    return NextResponse.json({
      ...credentials,
      identity,
      // Present once the interview has started: how much of the duration is
      // left on the server's clock, so HR's timer matches the candidate's.
      remainingSeconds: clock.kind === "active" ? clock.remainingSeconds : undefined,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    console.error("HR LiveKit token generation failed:", error);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "The interview room is not available right now. Please try again shortly.",
    );
  }
}
