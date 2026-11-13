import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyRecordingToken } from "@/lib/auth/session";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { PAUSE_GRACE_SECONDS, pauseStateFor } from "@/lib/interviews/pause.logic";
import { endPausedInterview } from "@/lib/interviews/pause.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

/** Why the candidate's page paused the interview. */
const PAUSE_REASONS = new Set(["fullscreen", "tab_hidden", "left"]);
const RECORDING_ID_PATTERN = /^candidate-[A-Za-z0-9-]{8,64}$/;

/**
 * The candidate's presence during an interview, from their own page.
 *
 * Leaving the full screen pauses the interview: the browser is the only thing
 * that can see it happen, and the server owns the two-minute window, the
 * record the recruiter reads afterwards, and the closing of a session nobody
 * came back to. Authorised by the recording token issued at the email gate,
 * so only the participant who joined this interview can report on it.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const recordingId = request.headers.get("x-recording-id") ?? "";
  if (!RECORDING_ID_PATTERN.test(recordingId)) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid participant id.");
  }
  if (!(await verifyRecordingToken(request.headers.get("x-recording-token"), roomId, recordingId))) {
    return interviewErrorResponse("ROOM_UNAVAILABLE", "This interview is not open to that participant.");
  }

  const body = await request.json().catch(() => null);
  const state = body && typeof body.state === "string" ? body.state : "";
  if (state !== "paused" && state !== "resumed" && state !== "expired") {
    return interviewErrorResponse("INVALID_INPUT", "Unknown presence state.");
  }
  const reason =
    typeof body?.reason === "string" && PAUSE_REASONS.has(body.reason) ? body.reason : null;

  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  if (room.status !== "active") {
    // A finished interview needs no further presence records.
    return NextResponse.json({ pause: null, graceSeconds: PAUSE_GRACE_SECONDS, closed: false });
  }

  const events = await repository.getEvents(roomId);
  const paused = pauseStateFor(events);

  if (state === "paused") {
    // One pause at a time, however many signals the page sends (an Esc also
    // hides the tab in some browsers).
    if (!paused) {
      await repository.appendEvents(roomId, [
        { type: "candidate_paused", at: new Date().toISOString(), data: { reason } },
      ]);
    }
  } else if (state === "resumed") {
    if (paused) {
      await repository.appendEvents(roomId, [
        { type: "candidate_resumed", at: new Date().toISOString(), data: { reason } },
      ]);
    }
  } else {
    // The page's two minutes are up. Make sure the pause itself is on the
    // record even if its message was lost, then close the interview.
    if (!paused) {
      await repository.appendEvents(roomId, [
        { type: "candidate_paused", at: new Date().toISOString(), data: { reason } },
      ]);
    }
    const result = await endPausedInterview(roomId);
    return NextResponse.json({
      pause: null,
      graceSeconds: PAUSE_GRACE_SECONDS,
      closed: result === "closed",
    });
  }

  const current = pauseStateFor(await repository.getEvents(roomId));
  return NextResponse.json({ pause: current, graceSeconds: PAUSE_GRACE_SECONDS, closed: false });
}
