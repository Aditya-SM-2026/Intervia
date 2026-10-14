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
  for (const event of events) {
    if (event.type !== "recording_started" && event.type !== "recording_uploaded") continue;
    const { bucket, path: objectPath, storage, recordingId, mimeType } = event.data;
    if (event.type === "recording_uploaded" && typeof bucket === "string" && typeof objectPath === "string") {
      // The copy of a locally-stored recording that was pushed to GCS once it
      // finished; playable from any deployment, so it is always listed.
      found.push({ kind: "gcs", object: { bucket, path: objectPath }, startedAt: event.at });
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