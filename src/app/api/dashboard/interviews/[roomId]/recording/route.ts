import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { pickRecording } from "@/lib/interviews/video-analysis.service";
import { MAX_RESPONSE_BYTES, clampRange, fileResponse, mimeFor, playableRecordingFile } from "@/lib/recordings/store";
import { fetchStoredObject } from "@/lib/storage/gcs";
import { findAgentAudio } from "@/lib/recordings/agent-audio";
import { buildMixedRecording } from "@/lib/recordings/mix";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

/** How long the first play may wait for the mix before serving the raw video. */
const MIX_WAIT_MS = 120_000;

/**
 * Plays back the candidate's recording to a signed-in recruiter. The file is
 * never public: it is streamed through here so access is always checked, and
 * byte ranges are honoured so the player can seek.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const repository = getInterviewRepository();
  let events = await repository.getEvents(roomId);

  // The mixed copy (the candidate's video plus every voice) is built in the
  // background when the interview ends, but a recruiter often opens the report
  // straight away and used to get the candidate-only video for the first few
  // minutes. Build it here when it is missing, so the first play already has
  // the interviewer and HR.
  if (!events.some((event) => event.type === "recording_mixed") && findAgentAudio(events)) {
    await Promise.race([
      buildMixedRecording(roomId).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), MIX_WAIT_MS)),
    ]);
    events = await repository.getEvents(roomId);
  }

  const recording = await pickRecording(events);
  if (!recording) {
    return interviewErrorResponse("ROOM_NOT_FOUND", "This interview has no recording.");
  }
  const range = request.headers.get("range");

  if (recording.kind === "local") {
    const file = await playableRecordingFile(recording.recording);
    if (!file) return interviewErrorResponse("ROOM_NOT_FOUND", "The recording is empty.");
    return fileResponse(file, mimeFor(recording.recording.format), range);
  }

  // Cloud Run answers 500 to any response over 32 MB, and a player streaming a
  // long recording asks for the rest of it as one open-ended range. Ask the
  // bucket for a bounded piece instead; Content-Range reports the true total,
  // so the player follows up with the next piece.
  const storedRange = clampRange(range) ?? `bytes=0-${MAX_RESPONSE_BYTES - 1}`;
  const stored = await fetchStoredObject(recording.object, { range: storedRange });
  if (!stored) {
    return interviewErrorResponse("SERVER_ERROR", "The recording storage cannot be read from this server.");
  }
  if (!stored.ok && stored.status !== 206) {
    return interviewErrorResponse("SERVER_ERROR", "The recording could not be loaded.");
  }

  const headers = new Headers({
    "Content-Type": recording.object.path.endsWith(".mp4") ? "video/mp4" : "video/webm",
    "Accept-Ranges": "bytes",
    // Candidate video: never stored by shared caches.
    "Cache-Control": "private, no-store",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = stored.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(stored.body, { status: stored.status, headers });
}
