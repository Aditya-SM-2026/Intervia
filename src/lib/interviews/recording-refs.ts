/**
 * Pure mapping from an interview's event log to the recordings it holds.
 * Kept free of server-only imports so it can be unit-tested directly.
 */

import { formatFromMime, type RecordingFormat } from "../recordings/recording-format.ts";

export interface LocalRecordingRef {
  roomId: string;
  recordingId: string;
  format: RecordingFormat;
}

export type RecordingRef =
  | {
      kind: "local";
      recording: LocalRecordingRef;
      startedAt: string;
      /** True for the mixed recording (candidate video + the agent's audio). */
      mixed?: boolean;
    }
  | {
      kind: "gcs";
      object: { bucket: string; path: string };
      startedAt: string;
      mixed?: boolean;
      /** The candidate recording this file is a copy of, when known. */
      recordingId?: string;
    };

export interface RecordingEvent {
  roomId: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

/** Every recording logged for an interview, oldest first. */
export function listRecordings(events: readonly RecordingEvent[]): RecordingRef[] {
  const found: RecordingRef[] = [];
  // The uploaded copy is logged when the upload finished, minutes after the
  // interview started. Answer windows are measured from the recording's real
  // start, so the upload honours the matching "recording_started" timestamp.
  const starts = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "recording_started") continue;
    const id = event.data.recordingId;
    if (typeof id === "string") starts.set(id, event.at);
  }
  for (const event of events) {
    if (event.type !== "recording_started" && event.type !== "recording_uploaded" && event.type !== "recording_mixed")
      continue;
    const { bucket, path: objectPath, storage, recordingId, mimeType } = event.data;
    const isMixed = event.type === "recording_mixed";
    if (
      isMixed &&
      typeof bucket === "string" &&
      typeof objectPath === "string"
    ) {
      // The candidate video with the agent's two-sided audio folded in; the
      // preferred playback copy when it exists.
      const startedAt =
        (typeof recordingId === "string" ? starts.get(recordingId) : undefined) ??
        (typeof event.data.startedAt === "string" ? event.data.startedAt : event.at);
      found.push({
        kind: "gcs",
        object: { bucket, path: objectPath },
        startedAt,
        mixed: true,
      });
      continue;
    }
    if (isMixed && storage === "local" && typeof recordingId === "string") {
      found.push({
        kind: "local",
        recording: {
          roomId: event.roomId,
          recordingId,
          format: formatFromMime(typeof mimeType === "string" ? mimeType : null),
        },
        startedAt:
          typeof event.data.startedAt === "string" ? event.data.startedAt : event.at,
        mixed: true,
      });
      continue;
    }
    if (event.type === "recording_uploaded" && typeof bucket === "string" && typeof objectPath === "string") {
      // The copy of a locally-stored recording that was pushed to GCS once it
      // finished; playable from any deployment, so it is always listed.
      const startedAt =
        (typeof recordingId === "string" ? starts.get(recordingId) : undefined) ?? event.at;
      found.push({
        kind: "gcs",
        object: { bucket, path: objectPath },
        startedAt,
        ...(typeof recordingId === "string" ? { recordingId } : {}),
      });
      continue;
    }
    if (storage === "local" && typeof recordingId === "string") {
      found.push({
        kind: "local",
        recording: {
          roomId: event.roomId,
          recordingId,
          format: formatFromMime(typeof mimeType === "string" ? mimeType : null),
        },
        startedAt: event.at,
      });
    } else if (typeof bucket === "string" && typeof objectPath === "string") {
      found.push({ kind: "gcs", object: { bucket, path: objectPath }, startedAt: event.at });
    }
  }
  return found;
}

export function hasRecording(events: readonly RecordingEvent[]): boolean {
  return listRecordings(events).length > 0;
}
/**
 * The stored (bucket) recording video analysis should read: the candidate's
 * own recording, not the mixed playback copy. The mix carries the
 * interviewer's voice too, which skews lip sync, the words per answer and the
 * same-voice check (a re-run on a mixed copy dropped a real lip-sync flag in
 * testing). The mix is used only when nothing else is stored.
 */
export function storedRecordingForAnalysis(
  events: readonly RecordingEvent[],
): Extract<RecordingRef, { kind: "gcs" }> | null {
  const stored = listRecordings(events).filter(
    (ref): ref is Extract<RecordingRef, { kind: "gcs" }> => ref.kind === "gcs",
  );
  const own = stored.filter((ref) => !ref.mixed);
  if (own.length === 0) return stored.at(-1) ?? null;
  // A candidate who rejoined leaves several recordings, and the last can be a
  // few seconds long (one ended at 41 seconds and the analysis measured no
  // answers at all). The longest one holds the interview: compare the sizes
  // logged when each recording finished, the latest winning a tie.
  const bytes = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "recording_finished") continue;
    const { recordingId, bytes: size } = event.data;
    if (typeof recordingId === "string" && typeof size === "number") bytes.set(recordingId, size);
  }
  let best = own[own.length - 1];
  for (const ref of own) {
    const size = ref.recordingId ? (bytes.get(ref.recordingId) ?? -1) : -1;
    const bestSize = best.recordingId ? (bytes.get(best.recordingId) ?? -1) : -1;
    if (size > bestSize) best = ref;
  }
  return best;
}
