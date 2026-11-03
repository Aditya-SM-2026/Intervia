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
      found.push({ kind: "gcs", object: { bucket, path: objectPath }, startedAt });
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