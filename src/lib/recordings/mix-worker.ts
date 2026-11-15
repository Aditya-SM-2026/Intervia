import "server-only";
import { listRecordings, type RecordingRef } from "@/lib/interviews/recording-refs";
import { enqueueHttpTask } from "@/lib/queue/cloud-tasks";
import { getInterviewRepository } from "@/server/repositories";
import { findAgentAudio, findHrAudio } from "./agent-audio";
import { recordingsBucket } from "./gcs-upload";
import { audioFilter, containerFor } from "./mix";

/**
 * Mixing on the video worker instead of the website. The website only works
 * out what to mix (files, clock offsets, audio filter); the worker downloads
 * the files, runs ffmpeg, stores the result and calls /api/internal/mix-result.
 */

/** True when this deployment mixes on the video worker. */
export function workerMixEnabled(): boolean {
  return Boolean(
    process.env.VIDEO_WORKER_URL?.trim() &&
      (process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim()) &&
      recordingsBucket(),
  );
}

/** Where the mixed copy of one interview is stored. */
export function mixedObjectPath(roomId: string, container: "mp4" | "webm"): string {
  return `interviews/${roomId}/mixed-${roomId}.${container}`;
}

export type WorkerMixRequest =
  | { status: "done" | "queued" }
  /** Nothing to mix (no interviewer audio), or only possible on the website. */
  | { status: "not_possible" | "in_process" }
  /** The candidate's video is not in storage yet; try again shortly. */
  | { status: "waiting"; reason: string };

/**
 * Hands one interview's mix to the worker. A rejoined candidate (several
 * video pieces) or files kept only on this server are left to the website's
 * own mix, which knows how to join the pieces.
 */
export async function requestWorkerMix(roomId: string): Promise<WorkerMixRequest> {
  const events = await getInterviewRepository().getEvents(roomId);
  if (events.some((event) => event.type === "recording_mixed")) return { status: "done" };
  const audio = findAgentAudio(events);
  if (!audio) return { status: "not_possible" };
  const hr = findHrAudio(events);
  if (audio.storage !== "gcs" || (hr && hr.storage !== "gcs")) return { status: "in_process" };

  const candidate = listRecordings(events).filter((ref) => !ref.mixed);
  const pieces = new Set(
    candidate.map((ref) => (ref.kind === "gcs" ? ref.object.path.split("/").pop()?.split(".")[0] : ref.recording.recordingId)),
  );
  if (pieces.size > 1) return { status: "in_process" };
  const video = candidate
    .filter((ref): ref is Extract<RecordingRef, { kind: "gcs" }> => ref.kind === "gcs")
    .at(-1);
  if (!video) {
    return candidate.length > 0
      ? { status: "waiting", reason: "the candidate's video is not in storage yet" }
      : { status: "not_possible" };
  }

  const bucket = recordingsBucket();
  const base = process.env.VIDEO_WORKER_URL?.trim();
  const secret = process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim();
  if (!bucket || !base || !secret) return { status: "in_process" };

  const container = containerFor(video);
  const startedAt = video.startedAt;
  const delta = (Date.parse(audio.startedAt) - Date.parse(startedAt)) / 1000;
  const hrDelta = hr ? (Date.parse(hr.startedAt) - Date.parse(startedAt)) / 1000 : null;
  const sent = await enqueueHttpTask({
    url: `${base.replace(/\/$/, "")}/mix`,
    secret,
    tag: "mix",
    payload: {
      roomId,
      inputs: {
        video: video.object,
        audio: { bucket: audio.bucket ?? bucket, path: audio.location },
        hr: hr ? { bucket: hr.bucket ?? bucket, path: hr.location } : null,
      },
      // Candidate from the video's own microphone first; the recorder's two
      // channels if the video turns out to carry no audio.
      filters: [audioFilter(delta, hrDelta, true), audioFilter(delta, hrDelta, false)],
      container,
      output: { bucket, path: mixedObjectPath(roomId, container) },
      recordingId: `mixed-${roomId}`,
      startedAt,
    },
  });
  if (!sent) throw new Error("the mix could not be handed to the video worker");
  return { status: "queued" };
}
