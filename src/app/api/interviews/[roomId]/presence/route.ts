import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyRecordingToken } from "@/lib/auth/session";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { PAUSE_GRACE_SECONDS, pauseBudgetFor } from "@/lib/interviews/pause.logic";
import { closeInterviewEarly } from "@/lib/interviews/pause.service";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

/** Why the candidate's page paused the interview. */
const PAUSE_REASONS = new Set(["fullscreen", "tab_hidden"]);
const RECORDING_ID_PATTERN = /^candidate-[A-Za-z0-9-]{8,64}$/;

/**
 * The candidate's presence during an interview, from their own page.
 *
 * Leaving the full screen pauses the interview: the browser is the only thing
 * that can see it happen, and the server owns the pause budget, the record the
 * recruiter reads afterwards, and the closing of a session nobody came back
 * to. Pressing Leave is the one way out that ends it on the spot. Authorised
 * by the recording token issued at the email gate, so only the participant who
 * joined this interview can report on it.
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
  if (state !== "paused" && state !== "resumed" && state !== "expired" && state !== "left") {
    return interviewErrorResponse("INVALID_INPUT", "Unknown presence state.");
  }
  const reason =
    typeof body?.reason === "string" && PAUSE_REASONS.has(body.reason) ? body.reason : null;

  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  if (room.status !== "active") {
    // A finished interview needs no further presence records.
    return NextResponse.json({
      pause: null,
      graceSeconds: PAUSE_GRACE_SECONDS,
      pauseSecondsLeft: 0,
      closed: false,
    });
  }

  const now = Date.now();
  const events = await repository.getEvents(roomId);
  const budget = pauseBudgetFor(events, now);

  if (state === "paused") {
    // One pause at a time, however many signals the page sends (an Esc also
    // hides the tab in some browsers).
    if (!budget.pause) {
      await repository.appendEvents(roomId, [
        { type: "candidate_paused", at: new Date(now).toISOString(), data: { reason } },
      ]);
    }
  } else if (state === "resumed") {
    if (budget.pause) {
      await repository.appendEvents(roomId, [
        { type: "candidate_resumed", at: new Date(now).toISOString(), data: { reason } },
      ]);
    }
  } else if (state === "expired") {
    // The page's pause budget is spent. Make sure the pause itself is on the
    // record even if its message was lost, then close the interview.
    if (!budget.pause) {
      await repository.appendEvents(roomId, [
        { type: "candidate_paused", at: new Date(now).toISOString(), data: { reason } },
      ]);
    }
    const result = await closeInterviewEarly(roomId, "pause_timeout");
    return NextResponse.json({
      pause: null,
      graceSeconds: PAUSE_GRACE_SECONDS,
      pauseSecondsLeft: 0,
      closed: result === "closed",
    });
  } else {
    // Leave: the candidate has chosen to end the interview, not to pause it.
    await repository.appendEvents(roomId, [
      { type: "candidate_exited", at: new Date(now).toISOString(), data: { reason } },
    ]);
    const result = await closeInterviewEarly(roomId, "candidate_exited");
    return NextResponse.json({
      pause: null,
      graceSeconds: PAUSE_GRACE_SECONDS,
      pauseSecondsLeft: 0,
      closed: result === "closed",
    });
  }

  const current = pauseBudgetFor(await repository.getEvents(roomId), Date.now());
  return NextResponse.json({
    pause: current.pause,
    graceSeconds: PAUSE_GRACE_SECONDS,
    pauseSecondsLeft: current.remainingSeconds,
    closed: false,
  });
}
