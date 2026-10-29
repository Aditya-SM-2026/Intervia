import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repositories";
import { recomputeOverallWithVideo } from "@/lib/interviews/scorecard.service";
import {
  videoBehaviourFromWorker,
  type VideoJob,
  type WorkerResult,
} from "@/lib/interviews/video-analysis.worker";

/**
 * The analysis worker's callback: it measures the recording and hands the
 * result back here, and the web app stores it in the interview's scorecard.
 * Authenticated with the shared internal secret, never by session cookie.
 */

function authorised(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-internal-secret") === secret;
}

interface CallbackBody extends WorkerResult {
  roomId?: string;
  job?: Partial<VideoJob>;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not allowed." } }, { status: 401 });
  }

  let body: CallbackBody;
  try {
    body = (await request.json()) as CallbackBody;
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON." } }, { status: 400 });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  if (!roomId) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "roomId is required." } }, { status: 400 });
  }

  const repository = getInterviewRepository();
  const scorecard = await repository.getScorecard(roomId);
  if (!scorecard) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "No scorecard for that room." } }, { status: 404 });
  }

  const job: VideoJob = {
    roomId,
    recording: { bucket: "", path: "" },
    startedAt: new Date(0).toISOString(),
    answers: [],
    hiddenCount: Number(body.job?.hiddenCount) || 0,
    hiddenSeconds: Number(body.job?.hiddenSeconds) || 0,
  };

  const video = videoBehaviourFromWorker(job, body);
  // The worker is the authority on the recording's length; keep the stored one otherwise.
  const storedVideo = {
    ...video,
    durationSeconds: video.durationSeconds ?? scorecard.video?.durationSeconds ?? null,
  };
  await repository.saveScorecard({
    ...scorecard,
    video: storedVideo,
    // The video score arrives after the scorecard was saved, so the weighted
    // total (and the average shown at the top of the report) has to be
    // recomputed now. Without this the video column stays empty even though
    // the analysis finished.
    overall: recomputeOverallWithVideo(scorecard, storedVideo.score),
  });

  return NextResponse.json({ ok: true, status: video.status });
}
