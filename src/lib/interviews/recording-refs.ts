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
  | { kind: "local"; recording: LocalRecordingRef; startedAt: string }
  | { kind: "gcs"; object: { bucket: string; path: string }; startedAt: string };

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
    if (event.type !== "recording_started" && event.type !== "recording_uploaded") continue;
    const { bucket, path: objectPath, storage, recordingId, mimeType } = event.data;
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