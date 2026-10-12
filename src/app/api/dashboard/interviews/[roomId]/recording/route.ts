import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { pickRecording } from "@/lib/interviews/video-analysis.service";
import { fileResponse, mimeFor, playableRecordingFile } from "@/lib/recordings/store";
import { fetchStoredObject } from "@/lib/storage/gcs";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

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

  const recording = await pickRecording(await getInterviewRepository().getEvents(roomId));
  if (!recording) {
    return interviewErrorResponse("ROOM_NOT_FOUND", "This interview has no recording.");
  }
  const range = request.headers.get("range");

  if (recording.kind === "local") {
    const file = await playableRecordingFile(recording.recording);
    if (!file) return interviewErrorResponse("ROOM_NOT_FOUND", "The recording is empty.");
    return fileResponse(file, mimeFor(recording.recording.format), range);
  }

  const stored = await fetchStoredObject(recording.object, { range });
  if (!stored) {
    return interviewErrorResponse("SERVER_ERROR", "The recording storage cannot be read from this server.");
  }
  if (!stored.ok && stored.status !== 206) {
    return interviewErrorResponse("SERVER_ERROR", "The recording could not be loaded.");
  }

  const headers = new Headers({
    "Content-Type": "video/mp4",
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
