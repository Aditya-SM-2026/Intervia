import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { recordingsBucket } from "@/lib/recordings/gcs-upload";
import { mixedObjectPath } from "@/lib/recordings/mix-worker";
import { getInterviewRepository } from "@/server/repositories";

/**
 * The video worker reports a finished mix: the candidate's video with every
 * voice, already stored in the recordings bucket. Recorded once, so the report
 * player switches to it. Authenticated with the internal secret.
 */

function authorised(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim();
  if (!secret) return false;
  const presented = Buffer.from(request.headers.get("x-internal-secret") ?? "");
  const expected = Buffer.from(secret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function bad(message: string) {
  return NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not allowed." } }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid JSON.");

  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  if (!roomIdSchema.safeParse(roomId).success) return bad("Invalid interview id.");
  const bucket = recordingsBucket();
  const container = body.mimeType === "video/mp4" ? "mp4" : body.mimeType === "video/webm" ? "webm" : null;
  // Only this interview's own mixed object in our bucket is accepted.
  if (!bucket || !container || body.bucket !== bucket || body.path !== mixedObjectPath(roomId, container)) {
    return bad("Unexpected storage location.");
  }

  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room) return bad("Interview not found.");
  const events = await repository.getEvents(roomId);
  if (!events.some((event) => event.type === "recording_mixed")) {
    await repository.appendEvents(roomId, [
      {
        type: "recording_mixed",
        at: new Date().toISOString(),
        data: {
          storage: "gcs",
          bucket,
          path: body.path,
          recordingId: `mixed-${roomId}`,
          mimeType: body.mimeType,
          startedAt: typeof body.startedAt === "string" && body.startedAt ? body.startedAt : room.scheduledAt,
        },
      },
    ]);
  }
  return NextResponse.json({ ok: true });
}
