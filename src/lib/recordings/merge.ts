import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  mediaDurationSeconds,
  playableRecordingFile,
  recordingsDir,
  runFfmpeg,
  sizeOf,
} from "./store";
import type { LocalRecordingRef, RecordingRef } from "../interviews/recording-refs";

export type MergedRecordingRef = Extract<RecordingRef, { kind: "local" }>;

/**
 * A candidate who leaves and rejoins produces one recording per session. The
 * report needs a single continuous video, so the segments are concatenated in
 * chronological order. The time a candidate was away is padded with black so
 * the merged timeline stays aligned with the interview's wall clock (and so
 * transcript offsets computed from the first segment's start remain valid).
 */

interface SegmentSource {
  recording: LocalRecordingRef;
  file: string;
  startAt: number;
  endAt: number;
}

const MERGE_LOCKS = new Map<string, Promise<MergedRecordingRef | null>>();

function mergedId(roomId: string): string {
  return `merged-${roomId}`;
}

function mergedRef(roomId: string, startedAt: string): MergedRecordingRef {
  return {
    kind: "local",
    recording: { roomId, recordingId: mergedId(roomId), format: "webm" },
    startedAt,
  };
}

function mergedRawPath(roomId: string): string {
  return path.join(recordingsDir(), roomId, `${mergedId(roomId)}.webm`);
}

/** Wall-clock span of every segment, oldest first (finished ones only). */
function segmentSpans(
  refs: readonly { recording: LocalRecordingRef; startedAt: string }[],
  events: readonly { type: string; at: string; data: Record<string, unknown> }[],
): { recording: LocalRecordingRef; startAt: number; endAt: number }[] {
  const finished = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "recording_finished") continue;
    const id = event.data.recordingId;
    if (typeof id === "string") finished.set(id, Date.parse(event.at));
  }
  return refs.map((ref, index) => {
    const startAt = Date.parse(ref.startedAt);
    const recordedEnd = finished.get(ref.recording.recordingId);
    const nextStart = index + 1 < refs.length ? Date.parse(refs[index + 1].startedAt) : Number.NaN;
    const endAt =
      recordedEnd ?? (Number.isFinite(nextStart) ? nextStart : startAt + 60_000);
    return { recording: ref.recording, startAt, endAt: Math.max(endAt, startAt) };
  });
}

export async function buildMergedRecording(
  roomId: string,
  refs: readonly { recording: LocalRecordingRef; startedAt: string }[],
  events: readonly { type: string; at: string; data: Record<string, unknown> }[],
): Promise<MergedRecordingRef | null> {
  if (refs.length < 2) return null;

  const dir = path.join(recordingsDir(), roomId);
  const metaPath = path.join(dir, `${mergedId(roomId)}.meta.json`);
  const fingerprint = JSON.stringify({
    ids: refs.map((ref) => `${ref.recording.recordingId}@${ref.startedAt}`),
  });

  // Reuse the previous merge when the segments have not changed.
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as { fingerprint?: string };
    if (meta.fingerprint === fingerprint && (await sizeOf(mergedRawPath(roomId))) > 0) {
      return mergedRef(roomId, refs[0].startedAt);
    }
  } catch {
    // No usable previous merge; build one below.
  }

  const spans = segmentSpans(refs, events);
  const sources: SegmentSource[] = [];
  for (const span of spans) {
    const file = await playableRecordingFile(span.recording);
    if (!file) return null; // A segment is missing: fall back to the old behaviour.
    sources.push({ recording: span.recording, file, startAt: span.startAt, endAt: span.endAt });
  }

  const lockKey = roomId;
  const existing = MERGE_LOCKS.get(lockKey);
  if (existing) return existing;
  const job = (async () => {
    try {
      const inputs: string[] = [];
      const chains: string[] = [];
      let index = 0;
      for (let i = 0; i < sources.length; i++) {
        inputs.push("-i", sources[i].file);
        chains.push(
          `[${index}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=15,setsar=1[v${index}]`,
          `[${index}:a]aresample=48000,aformat=channel_layouts=mono[a${index}]`,
        );
        index += 1;

        if (i + 1 < sources.length) {
          const gapSeconds = Math.max(0, (sources[i + 1].startAt - sources[i].endAt) / 1000 - 0.5);
          if (gapSeconds > 1) {
            const padded = gapSeconds.toFixed(2);
            inputs.push("-f", "lavfi", "-i", `color=c=black:s=640x360:r=15:d=${padded}`);
            inputs.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${padded}`);
            chains.push(`[${index}:v]fps=15,setsar=1[v${index}]`);
            chains.push(`[${index + 1}:a]aformat=sample_rates=48000:channel_layouts=mono[a${index + 1}]`);
            index += 2;
          }
        }
      }

      const pairs: string[] = [];
      for (let i = 0; i < index; i++) pairs.push(`[v${i}][a${i}]`);
      const filter = `${chains.join(";")};${pairs.join("")}concat=n=${index}:v=1:a=1[v][a]`;

      const raw = mergedRawPath(roomId);
      const temporary = `${raw}.tmp`;
      await fs.mkdir(dir, { recursive: true });
      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libvpx",
        "-b:v",
        "500k",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        temporary,
      ]);
      await fs.rename(temporary, raw);
      await fs.writeFile(metaPath, JSON.stringify({ fingerprint }), "utf8");
      return mergedRef(roomId, refs[0].startedAt);
    } catch (error) {
      console.error(
        `[recording] could not merge recordings for ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      MERGE_LOCKS.delete(lockKey);
    }
  })();
  MERGE_LOCKS.set(lockKey, job);
  return job;
}

/** Sanity helper used by tests: does the merged file exist and how long is it. */
export async function mergedRecordingInfo(
  roomId: string,
): Promise<{ bytes: number; durationSeconds: number | null } | null> {
  const bytes = await sizeOf(mergedRawPath(roomId));
  if (bytes <= 0) return null;
  const recording = { roomId, recordingId: mergedId(roomId), format: "webm" as const };
  const file = await playableRecordingFile(recording);
  const durationSeconds = file ? await mediaDurationSeconds(file) : null;
  return { bytes, durationSeconds };
}