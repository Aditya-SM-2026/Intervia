import "server-only";
import { listRecordings, type RecordingRef } from "./recording-refs";
import { pickRecording } from "./video-analysis.service";
import {
  combineSegmentReports,
  result,
  timedAnswers,
  type SegmentOutcome,
  type TimedAnswer,
} from "./video-analysis.service";
import { enqueueHttpTask } from "@/lib/queue/cloud-tasks";
import { recordingsBucket, uploadRecordingToGcs } from "@/lib/recordings/gcs-upload";
import type { InterviewEvent, InterviewTurn } from "./interview.types";
import type { GazeDirection, VideoBehaviour, VideoMomentKind } from "./scorecard.types";

/**
 * Sends the on-camera analysis off the web request.
 *
 * The web app only decides *what* to analyse (which recording, which answer
 * windows), hands that to the worker, and stores the worker's reply when it
 * arrives. The measuring itself (ffmpeg + OpenCV + MediaPipe) runs in the
 * worker service, so a slow recording never holds a page request open.
 */

export type VideoAnalysisMode = "inline" | "worker";

export function videoAnalysisMode(): VideoAnalysisMode {
  return (process.env.VIDEO_ANALYSIS_MODE ?? "inline").trim().toLowerCase() === "worker"
    ? "worker"
    : "inline";
}

export interface VideoJobAnswer {
  turnSeq: number;
  /** Seconds into the recording. */
  start: number;
  end: number;
  questionStart: number;
}

export interface VideoJob {
  roomId: string;
  recording: { bucket: string; path: string };
  startedAt: string;
  answers: VideoJobAnswer[];
  hiddenCount: number;
  hiddenSeconds: number;
}

/** The GCS copy of a recording, which any worker instance can read. */
function storedRecording(
  events: readonly InterviewEvent[],
): Extract<RecordingRef, { kind: "gcs" }> | null {
  const stored = listRecordings(events).filter(
    (ref): ref is Extract<RecordingRef, { kind: "gcs" }> => ref.kind === "gcs",
  );
  return stored.at(-1) ?? null;
}

/** Where the worker should read the recording from. */
type SourceLocation = { bucket: string; path: string; startTime: string };

/**
 * Resolves the recording the worker should read. Older interviews hold their
 * recording only on this server's disk; copying it to the recordings bucket
 * first makes it reachable from the worker.
 */
async function sourceLocation(events: readonly InterviewEvent[]): Promise<SourceLocation | null> {
  const stored = storedRecording(events);
  if (stored) {
    return { bucket: stored.object.bucket, path: stored.object.path, startTime: stored.startedAt };
  }
  const local = listRecordings(events)
    .filter((ref): ref is Extract<RecordingRef, { kind: "local" }> => ref.kind === "local")
    .at(-1);
  const bucket = recordingsBucket();
  if (!local || !bucket) return null;
  const objectPath = await uploadRecordingToGcs(local.recording);
  if (!objectPath) return null;
  return { bucket, path: objectPath, startTime: local.startedAt };
}

/**
 * Builds the worker payload, or returns the behaviour to store when there is
 * nothing to analyse. Worker mode reads the stored (GCS) copy of a recording;
 * when asked to, a server-only recording is published to the bucket first.
 */
export async function buildVideoJob(
  roomId: string,
  events: readonly InterviewEvent[],
  turns: readonly InterviewTurn[],
  tab: { hiddenCount: number; hiddenSeconds: number },
  options: { uploadLocal?: boolean } = {},
): Promise<{ job: VideoJob } | { behaviour: VideoBehaviour }> {
  const chosen = await pickRecording(events);
  if (!chosen) {
    return {
      behaviour: result("no_recording", "This interview was not recorded, so there is no video to analyse."),
    };
  }
  let location: SourceLocation | null = null;
  if (options.uploadLocal) {
    location = await sourceLocation(events);
  } else {
    const stored = storedRecording(events);
    if (stored) {
      location = { bucket: stored.object.bucket, path: stored.object.path, startTime: stored.startedAt };
    }
  }
  if (!location) {
    return {
      behaviour: result(
        "not_configured",
        "The video is stored only on the web server and could not be prepared for analysis.",
      ),
    };
  }
  const answers: TimedAnswer[] = timedAnswers(turns, Date.parse(location.startTime));
  return {
    job: {
      roomId,
      recording: { bucket: location.bucket, path: location.path },
      startedAt: location.startTime,
      answers: answers.map((answer) => ({
        turnSeq: answer.turnSeq,
        start: answer.start,
        end: answer.end,
        questionStart: answer.questionStart,
      })),
      hiddenCount: tab.hiddenCount,
      hiddenSeconds: tab.hiddenSeconds,
    },
  };
}

/** Hands one job to the worker. Returns false when the hand-off failed. */
export async function enqueueVideoAnalysis(job: VideoJob): Promise<boolean> {
  const base = process.env.VIDEO_WORKER_URL?.trim();
  const secret = process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim();
  if (!base || !secret) {
    console.warn("[video] worker not configured (VIDEO_WORKER_URL / INTERNAL_SECRET)");
    return false;
  }
  return enqueueHttpTask({
    url: `${base.replace(/\/$/, "")}/analyse`,
    payload: job,
    secret,
    tag: "video-analysis",
  });
}

/** A queued video section, shown until the worker calls back. */
export function queuedVideo(): VideoBehaviour {
  return result("queued", "Video analysis is running. The result will appear here shortly.");
}

const DIRECTIONS: GazeDirection[] = [
  "centre",
  "left",
  "right",
  "up",
  "down",
  "up_left",
  "up_right",
  "down_left",
  "down_right",
  "unclear",
];
const KINDS: VideoMomentKind[] = [
  "looking_away",
  "reading",
  "other_person",
  "second_device",
  "left_frame",
  "other",
];

interface WorkerAnswer {
  turnSeq: number;
  start: number;
  end: number;
  whileListening: string;
  whileAnswering: string;
  steady?: boolean;
  reading?: boolean;
  note?: string;
}

interface WorkerMoment {
  atSeconds: number;
  durationSeconds: number;
  kind: string;
  description: string;
}

/** A clip as the worker reports it. */
export interface WorkerSegment {
  offset: number;
  faceVisible: boolean;
  model: string;
  answers: WorkerAnswer[];
  moments: WorkerMoment[];
}

export interface WorkerResult {
  status: "analysed" | "failed";
  reason?: string | null;
  durationSeconds?: number | null;
  totalSegments?: number;
  segments?: WorkerSegment[];
}

function direction(value: string): GazeDirection {
  const normalised = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_").replace("center", "centre");
  return (DIRECTIONS as string[]).includes(normalised) ? (normalised as GazeDirection) : "unclear";
}

function kind(value: string): VideoMomentKind {
  return (KINDS as string[]).includes(value) ? (value as VideoMomentKind) : "other";
}

/** Stores the worker's reply in the same shape the inline analyser produces. */
export function videoBehaviourFromWorker(
  job: VideoJob,
  payload: WorkerResult,
): VideoBehaviour {
  if (payload.status !== "analysed" || !payload.segments?.length) {
    return result(
      "failed",
      payload.reason?.trim() || "The video analysis did not complete. Regenerate to try again.",
    );
  }
  const reports: SegmentOutcome[] = payload.segments.map((segment) => ({
    offset: Number(segment.offset) || 0,
    faceVisible: segment.faceVisible !== false,
    model: String(segment.model || "unknown"),
    answers: (segment.answers ?? []).map((answer) => ({
      turnSeq: Number(answer.turnSeq),
      start: Number(answer.start),
      end: Number(answer.end),
      whileListening: direction(answer.whileListening),
      whileAnswering: direction(answer.whileAnswering),
      steady: answer.steady === true,
      reading: answer.reading === true,
      note: String(answer.note ?? "").slice(0, 300),
    })),
    moments: (segment.moments ?? []).map((moment) => ({
      atSeconds: Number(moment.atSeconds) || 0,
      durationSeconds: Number(moment.durationSeconds) || 0,
      kind: kind(moment.kind),
      description: String(moment.description ?? "").slice(0, 400),
    })),
  }));
  return combineSegmentReports(reports, {
    totalSegments: payload.totalSegments ?? reports.length,
    tab: { hiddenCount: job.hiddenCount, hiddenSeconds: job.hiddenSeconds },
    durationSeconds:
      payload.durationSeconds === null || payload.durationSeconds === undefined
        ? null
        : Number(payload.durationSeconds),
  });
}
