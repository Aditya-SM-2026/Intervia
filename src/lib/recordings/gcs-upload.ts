import "server-only";
import { promises as fs } from "node:fs";
import { uploadStoredObject } from "@/lib/storage/gcs";
import { mimeFor, playableRecordingFile, type LocalRecording } from "./store";

/**
 * Pushes a finished recording to Google Cloud Storage, so it can be played
 * back from any deployment (the container's own disk is ephemeral and only
 * holds recordings made on it). Enabled by setting RECORDINGS_GCS_BUCKET.
 */

export function recordingsBucket(): string | null {
  return process.env.RECORDINGS_GCS_BUCKET?.trim() || null;
}

/** Uploads the seekable copy of the recording; resolves with its object path, or null. */
export async function uploadRecordingToGcs(recording: LocalRecording): Promise<string | null> {
  const bucket = recordingsBucket();
  if (!bucket) return null;
  const file = await playableRecordingFile(recording);
  if (!file) return null;
  const bytes = new Uint8Array(await fs.readFile(file));
  const objectPath = `${recording.roomId}/${recording.recordingId}.play.${recording.format}`;
  const ok = await uploadStoredObject({ bucket, path: objectPath }, bytes, mimeFor(recording.format));
  return ok ? objectPath : null;
}