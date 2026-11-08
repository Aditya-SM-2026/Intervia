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
import type {
  AnswerGaze,
  AnswerMeasures,
  GazeDirection,
  VideoBehaviour,
  VideoMeasures,
  VideoMoment,
  VideoMomentKind,
} from "./scorecard.types";
import { measuredFindings, measuredVideoScore, medianAtScreen } from "./scoring";

/**
 * Sends the on-camera analysis off the web request.
 *
 * The web app only decides *what* to analyse (which recording, which answer
 * windows), hands that to the worker, and stores the worker's reply when it
 * arrives. The measuring itself (ffmpeg + OpenCV + MediaPipe) runs in the
 * worker service, so a slow recording never holds a page request open.
 */

export type VideoAnalysisMode = "inline" | "worker";

/**
 * Worker mode is the default whenever a worker is configured: the calibrated
 * (v2) analysis with audio checks only runs there. VIDEO_ANALYSIS_MODE=inline
 * forces the older in-process analyser.
 */
export function videoAnalysisMode(): VideoAnalysisMode {
  const explicit = (process.env.VIDEO_ANALYSIS_MODE ?? "").trim().toLowerCase();
  if (explicit === "worker" || explicit === "inline") return explicit;
  return process.env.VIDEO_WORKER_URL?.trim() ? "worker" : "inline";
}

export interface VideoJobAnswer {
  turnSeq: number;
  /** Seconds into the recording. */
  start: number;
  end: number;
  questionStart: number;
  questionEnd: number | null;
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
        questionEnd: answer.questionEnd,
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
  return result("queued", "Video analysis is running. The result will appear here shortly.", {
    queuedAt: new Date().toISOString(),
  });
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
  reason?: string | null;
  measuredFrames?: number;
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
  /** The calibrated v2 measurements (worker from 2026-11). */
  analysis?: unknown;
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
  if (payload.status === "analysed" && payload.analysis && typeof payload.analysis === "object") {
    return videoBehaviourFromMeasures(
      payload.analysis as VideoMeasures,
      payload.durationSeconds === null || payload.durationSeconds === undefined
        ? null
        : Number(payload.durationSeconds),
    );
  }
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
      reason: answer.reason ? String(answer.reason).slice(0, 240) : null,
      measuredFrames: Number(answer.measuredFrames) || 0,
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

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Old-style direction words for an answer, so the gaze grid keeps working. */
function directionFromOffset(offset: unknown): GazeDirection {
  if (!Array.isArray(offset) || offset.length < 2) return "unclear";
  const [x, y] = [Number(offset[0]), Number(offset[1])];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "unclear";
  const h = Math.abs(x) < 3 ? "" : x < 0 ? "left" : "right";
  const v = Math.abs(y) < 3 ? "" : y > 0 ? "down" : "up";
  if (!h && !v) return "centre";
  if (!h) return v as GazeDirection;
  if (!v) return h as GazeDirection;
  return `${v}_${h}` as GazeDirection;
}

/** Stores the calibrated analysis, with the older per-answer shape filled in. */
export function videoBehaviourFromMeasures(raw: VideoMeasures, durationSeconds: number | null): VideoBehaviour {
  const measures: VideoMeasures = {
    fps: num(raw.fps) ?? 15,
    baseline: raw.baseline ?? { frames: 0, source: "none" },
    spots: Array.isArray(raw.spots) ? raw.spots.slice(0, 3) : [],
    answers: (Array.isArray(raw.answers) ? raw.answers : []).map((answer: AnswerMeasures) => ({
      ...answer,
      turnSeq: Number(answer.turnSeq),
      start: Number(answer.start) || 0,
      end: Number(answer.end) || 0,
    })),
    absences: Array.isArray(raw.absences) ? raw.absences : [],
    quality: raw.quality ?? { brightness: null, facePx: null, sharpness: null, measurable: 0, enhanced: 0 },
    faceSeen: raw.faceSeen !== false,
    checks: raw.checks ?? { audio: false, transcriber: false, voice: false, phone: false },
    partial: raw.partial === true,
    processingSeconds: num(raw.processingSeconds) ?? 0,
  };
  const findings = measuredFindings(measures);
  // The per-answer flags follow the same rules as the Integrity section.
  const readingSeqs = new Set(
    findings
      .filter((finding) => finding.kind === "reading_eyes" || finding.kind === "screen_reading")
      .flatMap((finding) => finding.turnSeqs),
  );
  const spotSeqs = new Set(
    findings.filter((finding) => finding.kind === "fixed_spot").flatMap((finding) => finding.turnSeqs),
  );
  const spot = measures.spots[0];
  const answers: AnswerGaze[] = measures.answers.map((answer) => {
    const held = spotSeqs.has(answer.turnSeq);
    const readable = answer.atScreenShare !== null && answer.atScreenShare !== undefined;
    return {
      turnSeq: answer.turnSeq,
      atSeconds: Math.round(answer.start),
      durationSeconds: Math.round(answer.end - answer.start),
      whileListening: readable ? "centre" : "unclear",
      whileAnswering: readable ? directionFromOffset((answer as { medianOffset?: unknown }).medianOffset) : "unclear",
      steady: held,
      reading: readingSeqs.has(answer.turnSeq),
      note: readable
        ? `At the screen for ${Math.round((answer.atScreenShare as number) * 100)}% of the answer${held && spot ? `; held ${spot.where}` : ""}`
        : "",
      reason: answer.reason ?? null,
      measuredFrames: answer.measuredFrames,
    };
  });
  const moments: VideoMoment[] = findings
    .filter((finding) => finding.atSeconds !== null)
    .map((finding) => ({
      atSeconds: finding.atSeconds as number,
      durationSeconds: 0,
      kind:
        finding.kind === "reading_eyes"
          ? "reading"
          : finding.kind === "second_face"
            ? "other_person"
            : finding.kind === "phone"
              ? "second_device"
              : finding.kind === "left_frame"
                ? "left_frame"
                : finding.kind === "fixed_spot"
                  ? "looking_away"
                  : "other",
      description: finding.title,
    }));
  const judged = measures.answers.filter((answer) => answer.atScreenShare !== null && answer.atScreenShare !== undefined);
  const enough = measures.faceSeen && judged.length >= 3;
  const videoFindings = findings.filter((finding) => finding.source === "video");
  return {
    status: "analysed",
    version: 2,
    measures,
    score: enough ? measuredVideoScore(findings) : null,
    attentionPercent: medianAtScreen(measures.answers),
    moments,
    summary: !measures.faceSeen
      ? "No face could be seen in the recording."
      : videoFindings.length === 0
        ? `Across ${judged.length} answers measured on camera, nothing stood out: the candidate mostly looked at their screen, and where they looked away it wandered, as people do when thinking.`
        : videoFindings.map((finding) => finding.title).join(". ") + ".",
    model: "local-cv v2 (mediapipe, faster-whisper, wespeaker, yolox)",
    reason: !measures.faceSeen
      ? "No face could be seen in the recording."
      : !enough
        ? `${judged.length} of ${measures.answers.length} answers could be measured on camera, too few to judge a pattern.`
        : null,
    answers,
    pattern: null,
    durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds),
  };
}
