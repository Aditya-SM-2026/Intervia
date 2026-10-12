import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyRecordingToken } from "@/lib/auth/session";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import {
  appendRecordingChunk,
  formatFromMime,
  markRecordingFinished,
  type LocalRecording,
} from "@/lib/recordings/store";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
const RECORDING_ID_PATTERN = /^candidate-[A-Za-z0-9-]{8,64}$/;

/**
 * Receives the candidate's own recording from their browser, a few seconds at
 * a time. Authorised by the recording token issued with the join credentials
 * (after the email gate and consent), which is bound to this interview and
 * this participant.
 *
 * `offset` is the number of bytes sent before this piece. `final=1` marks the
 * last piece, after which the recording is ready to play and analyse.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const recordingId = request.headers.get("x-recording-id") ?? "";
  if (!RECORDING_ID_PATTERN.test(recordingId)) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid recording id.");
  }
  if (!(await verifyRecordingToken(request.headers.get("x-recording-token"), roomId, recordingId))) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Recording upload is not authorised." } },
      { status: 401 },
    );
  }

  const offset = Number(request.nextUrl.searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) {
    return interviewErrorResponse("INVALID_INPUT", "Invalid offset.");
  }
  const final = request.nextUrl.searchParams.get("final") === "1";

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_CHUNK_BYTES) {
    return interviewErrorResponse("INVALID_INPUT", "Recording piece is too large.");
  }

  const mimeType = (request.headers.get("content-type") ?? "video/webm").slice(0, 80);
  const recording: LocalRecording = { roomId, recordingId, format: formatFromMime(mimeType) };
  const repository = getInterviewRepository();

  let size = offset;
  if (bytes.byteLength > 0) {
    const appended = await appendRecordingChunk(recording, offset, bytes);
    if (!appended.ok) {
      // The browser resumes from the size the server actually has.
      return NextResponse.json(
        { error: { code: appended.reason, message: "Recording piece rejected." }, size: appended.size },
        { status: appended.reason === "too_large" ? 413 : 409 },
      );
    }
    size = appended.size;
    if (appended.first) {
      const elapsedMs = Number(request.headers.get("x-recording-elapsed-ms"));
      const startedAtMs =
        Date.now() - (Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.min(elapsedMs, 120_000) : 0);
      await repository.appendEvents(roomId, [
        {
          type: "recording_started",
          at: new Date(startedAtMs).toISOString(),
          data: { storage: "local", recordingId, mimeType, scope: "candidate" },
        },
      ]);
    }
  }

  if (final) {
    await markRecordingFinished(recording);
    await repository.appendEvents(roomId, [
      {
        type: "recording_finished",
        at: new Date().toISOString(),
        data: { recordingId, bytes: size },
      },
    ]);
  }
  return NextResponse.json({ ok: true, size });
}
