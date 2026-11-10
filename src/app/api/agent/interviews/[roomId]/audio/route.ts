import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { getInterviewRepository } from "@/server/repositories";
import { storeAgentAudio, storeHrAudio } from "@/lib/recordings/agent-audio";

type RouteParams = { params: Promise<{ roomId: string }> };

const MAX_BYTES = 256 * 1024 * 1024;

/**
 * Receives the interview's two-sided audio track from the agent worker, which
 * records the candidate and its own played voice to one stereo OGG (see
 * agent/intervia_agent/audio_track.py). The file is stored next to the
 * candidate's recording; the mix step folds both voices into the video the
 * recruiter plays.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = requireAgent(request);
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid interview id.");
  }

  const mimeType = (request.headers.get("content-type") ?? "").slice(0, 80);
  const kind = (request.headers.get("x-audio-kind") ?? "").trim().toLowerCase();
  const isHr = kind === "hr";
  if (isHr ? !mimeType.includes("wav") : !mimeType.includes("ogg")) {
    return interviewErrorResponse(
      "INVALID_INPUT",
      isHr
        ? "HR's audio track must be a wav file."
        : "The interview audio track must be an ogg file.",
    );
  }
  const startedAt = request.headers.get("x-audio-started-at") ?? new Date().toISOString();

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength <= 0) {
    return interviewErrorResponse("INVALID_INPUT", "Interview audio track is empty.");
  }
  if (bytes.byteLength > MAX_BYTES) {
    return interviewErrorResponse("INVALID_INPUT", "Interview audio track is too large.");
  }

  if (!(await getInterviewRepository().get(roomId))) {
    return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");
  }

  if (isHr) {
    const stored = await storeHrAudio(roomId, bytes, startedAt);
    if (!stored) {
      return interviewErrorResponse("SERVER_ERROR", "HR's audio could not be stored.");
    }
    await getInterviewRepository().appendEvents(roomId, [
      {
        type: "interview_hr_audio_uploaded",
        at: new Date().toISOString(),
        data: {
          storage: stored.storage,
          location: stored.location,
          ...(stored.bucket ? { bucket: stored.bucket } : {}),
          startedAt: stored.startedAt,
          mimeType,
        },
      },
    ]);
    return NextResponse.json({ ok: true, storage: stored.storage });
  }

  const stored = await storeAgentAudio(roomId, bytes, startedAt);
  if (!stored) {
    return interviewErrorResponse("SERVER_ERROR", "The interview audio could not be stored.");
  }

  await getInterviewRepository().appendEvents(roomId, [
    {
      type: "interview_audio_uploaded",
      at: new Date().toISOString(),
      data: {
        storage: stored.storage,
        location: stored.location,
        ...(stored.bucket ? { bucket: stored.bucket } : {}),
        startedAt: stored.startedAt,
        mimeType: mimeType,
      },
    },
  ]);
  return NextResponse.json({ ok: true, storage: stored.storage });
}