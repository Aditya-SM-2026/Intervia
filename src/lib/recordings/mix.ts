import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegPath, recordingsDir, runFfmpeg, sizeOf } from "./store";
import { uploadStoredObject } from "@/lib/storage/gcs";
import { findAgentAudio, agentAudioFile } from "./agent-audio";
import { recordingsBucket } from "./gcs-upload";
import { pickCandidateRecording } from "@/lib/interviews/video-analysis.service";
import { getInterviewRepository } from "@/server/repositories";
import type { RecordingRef } from "@/lib/interviews/recording-refs";

/**
 * Folds the agent's two-sided audio (candidate left channel, interviewer's
 * played voice right channel) into the candidate's video recording, so the
 * report player shows one file containing both voices.
 *
 * The result is cached per interview: the mix runs once, after the interview
 * ends, and the file then lives on this server's disk or in the recordings
 * bucket. Failure is safe: the candidate-only video stays playable exactly as
 * before, and a later call can retry.
 */

const MIX_LOCKS = new Map<string, Promise<boolean>>();

/** The audio filter chain for one mix: align to the video's clock, then fold
 * the two speaker channels into one mono track. */
function audioFilter(deltaSeconds: number): string {
  const ms = Math.round(Math.abs(deltaSeconds) * 1000);
  const offset =
    ms === 0
      ? ""
      : deltaSeconds > 0
        ? `adelay=${ms}:all=1,`
        : `atrim=start=${Math.abs(deltaSeconds).toFixed(3)},asetpts=PTS-STARTPTS,`;
  return `[1:a]${offset}pan=mono|c0=0.5*c0+0.5*c1[a]`;
}

function containerFor(ref: RecordingRef): "mp4" | "webm" {
  if (ref.kind === "gcs") return ref.object.path.endsWith(".mp4") ? "mp4" : "webm";
  return ref.recording.format;
}

/** A local copy of the candidate video for the mix, downloaded when needed. */
async function videoFileFor(ref: RecordingRef, workDir: string): Promise<string | null> {
  if (ref.kind === "local") {
    const { playableRecordingFile } = await import("./store");
    return playableRecordingFile(ref.recording);
  }
  const { fetchStoredObject } = await import("@/lib/storage/gcs");
  const response = await fetchStoredObject(ref.object);
  if (!response || !response.ok || !response.body) return null;
  const target = path.join(workDir, `candidate.${containerFor(ref)}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

async function mixInto(
  videoFile: string,
  audioFile: string,
  outputFile: string,
  deltaSeconds: number,
): Promise<void> {
  const container = outputFile.endsWith(".mp4") ? "mp4" : "webm";
  const args = [
    "-y",
    "-i",
    videoFile,
    "-i",
    audioFile,
    "-filter_complex",
    audioFilter(deltaSeconds),
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    container === "mp4" ? "aac" : "libopus",
    "-b:a",
    "96k",
    ...(container === "mp4" ? ["-movflags", "+faststart"] : []),
    "-shortest",
    outputFile,
  ];
  await runFfmpeg(args, 600_000);
}

/**
 * Builds and stores the mixed recording for one interview. Returns true when a
 * mixed recording exists (previously or newly built), false when mixing is not
 * possible or failed. Safe to call repeatedly and concurrently.
 */
export async function buildMixedRecording(roomId: string): Promise<boolean> {
  const repository = getInterviewRepository();
  const events = await repository.getEvents(roomId);
  if (events.some((event) => event.type === "recording_mixed")) return true;
  const audioRef = findAgentAudio(events);
  const videoRef = await pickCandidateRecording(events);
  if (!audioRef || !videoRef) return false;
  if (!ffmpegPath()) return false;

  const existing = MIX_LOCKS.get(roomId);
  if (existing) return existing;

  const job = (async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "interview-mix-"));
    try {
      const [videoFile, audioFile] = await Promise.all([
        videoFileFor(videoRef, workDir),
        agentAudioFile(audioRef, workDir),
      ]);
      if (!videoFile || !audioFile) return false;

      // The agent's clock and the candidate's recording start seconds apart;
      // shift the audio onto the video's timeline first.
      const deltaSeconds =
        (Date.parse(audioRef.startedAt) - Date.parse(videoRef.startedAt)) / 1000;
      const container = containerFor(videoRef);
      const mixed = path.join(workDir, `mixed.${container}`);
      await mixInto(videoFile, audioFile, mixed, deltaSeconds);
      if ((await sizeOf(mixed)) <= 0) return false;

      const recordingId = `mixed-${roomId}`;
      const mimeType = container === "mp4" ? "video/mp4" : "video/webm";
      const bucket = recordingsBucket();
      if (bucket) {
        const objectPath = `interviews/${roomId}/${recordingId}.${container}`;
        const bytes = new Uint8Array(await fs.readFile(mixed));
        const ok = await uploadStoredObject({ bucket, path: objectPath }, bytes, mimeType);
        if (!ok) return false;
        await getInterviewRepository().appendEvents(roomId, [
          {
            type: "recording_mixed",
            at: new Date().toISOString(),
            data: {
              storage: "gcs",
              bucket,
              path: objectPath,
              recordingId,
              mimeType,
              startedAt: videoRef.startedAt,
            },
          },
        ]);
        return true;
      }

      // Local development: no bucket configured, keep the file on disk.
      const target = path.join(recordingsDir(), roomId, `${recordingId}.${container}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(mixed, target);
      await getInterviewRepository().appendEvents(roomId, [
        {
          type: "recording_mixed",
          at: new Date().toISOString(),
          data: {
            storage: "local",
            recordingId,
            mimeType,
            startedAt: videoRef.startedAt,
          },
        },
      ]);
      return true;
    } catch (error) {
      console.error(
        `[recording] could not mix interview audio for ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
      MIX_LOCKS.delete(roomId);
    }
  })();
  MIX_LOCKS.set(roomId, job);
  return job;
}
