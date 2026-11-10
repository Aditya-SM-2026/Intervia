import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ffmpegPath, recordingsDir, runFfmpeg, sizeOf } from "./store";
import { uploadStoredObject } from "@/lib/storage/gcs";
import { findAgentAudio, agentAudioFile, findHrAudio, hrAudioFile } from "./agent-audio";
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

/** The audio filter chain for one mix: align each source to the video's clock,
 * then fold every speaker into one mono track. */
function audioFilter(deltaSeconds: number, hrDeltaSeconds: number | null): string {
  const offsetFor = (delta: number): string => {
    const ms = Math.round(Math.abs(delta) * 1000);
    if (ms === 0) return "";
    return delta > 0
      ? `adelay=${ms}:all=1,`
      : `atrim=start=${Math.abs(delta).toFixed(3)},asetpts=PTS-STARTPTS,`;
  };

  const twoSpeakers = `[1:a]${offsetFor(deltaSeconds)}pan=mono|c0=0.5*c0+0.5*c1,aresample=48000`;
  if (hrDeltaSeconds === null) return `${twoSpeakers}[a]`;

  // HR's microphone is its own mono file, recorded by the agent from the HR
  // participant's track. Mixing it in gives the report all three voices.
  return (
    `${twoSpeakers}[a1];` +
    `[2:a]${offsetFor(hrDeltaSeconds)}aresample=48000,pan=mono|c0=c0[a2];` +
    `[a1][a2]amix=inputs=2:duration=longest:normalize=0[a]`
  );
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
  hrFile: string | null,
  outputFile: string,
  deltaSeconds: number,
  hrDeltaSeconds: number | null,
): Promise<void> {
  const container = outputFile.endsWith(".mp4") ? "mp4" : "webm";
  const args = [
    "-y",
    "-i",
    videoFile,
    "-i",
    audioFile,
    ...(hrFile ? ["-i", hrFile] : []),
    "-filter_complex",
    audioFilter(deltaSeconds, hrFile ? hrDeltaSeconds : null),
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
  const hrRef = findHrAudio(events);
  const videoRef = await pickCandidateRecording(events);
  if (!audioRef || !videoRef) return false;
  if (!ffmpegPath()) return false;

  const existing = MIX_LOCKS.get(roomId);
  if (existing) return existing;

  const job = (async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "interview-mix-"));
    try {
      const [videoFile, audioFile, hrFile] = await Promise.all([
        videoFileFor(videoRef, workDir),
        agentAudioFile(audioRef, workDir),
        hrRef ? hrAudioFile(hrRef, workDir) : Promise.resolve(null),
      ]);
      if (!videoFile || !audioFile) return false;

      // The agent's clock and the candidate's recording start seconds apart;
      // so do HR's own recording. Shift both onto the video's timeline first.
      const deltaSeconds =
        (Date.parse(audioRef.startedAt) - Date.parse(videoRef.startedAt)) / 1000;
      const hrDeltaSeconds = hrRef
        ? (Date.parse(hrRef.startedAt) - Date.parse(videoRef.startedAt)) / 1000
        : null;
      const container = containerFor(videoRef);
      const mixed = path.join(workDir, `mixed.${container}`);
      await mixInto(videoFile, audioFile, hrFile, mixed, deltaSeconds, hrDeltaSeconds);
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
