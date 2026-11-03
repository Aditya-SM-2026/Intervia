import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchStoredObject, uploadStoredObject } from "@/lib/storage/gcs";
import { recordingsBucket } from "./gcs-upload";
import { recordingsDir } from "./store";

/**
 * The interview's two-sided audio track.
 *
 * The interviewer agent records the whole conversation (candidate and its own
 * played voice) to one stereo OGG and uploads it when the interview ends (see
 * agent/intervia_agent/audio_track.py). It is kept as its own file next to the
 * candidate's video; the mixing step (./mix) folds it into the recording so a
 * recruiter hears both voices in the player.
 */

export const AGENT_AUDIO_MIME = "audio/ogg";
const MAX_AGENT_AUDIO_BYTES = 256 * 1024 * 1024;

/** Where the agent's audio lives for one interview. */
export interface AgentAudioRef {
  storage: "gcs" | "local";
  /** GCS bucket name (gcs only). */
  bucket?: string;
  /** Object path in the bucket (gcs) or absolute file path on this server (local). */
  location: string;
  /** When the agent's own recording began (its session start). */
  startedAt: string;
}

/** Object path in the bucket for one interview's audio. */
export function agentAudioObjectPath(roomId: string): string {
  return `interviews/${roomId}/agent-audio.ogg`;
}

/** File on this server's disk for one interview's audio (no bucket configured). */
export function agentAudioDiskFile(roomId: string): string {
  return path.join(recordingsDir(), roomId, "agent-audio.ogg");
}

/** Stores an uploaded audio file; the interview's event log is updated by the route. */
export async function storeAgentAudio(
  roomId: string,
  bytes: Uint8Array,
  startedAt: string,
): Promise<{ storage: "gcs" | "local"; location: string; startedAt: string; bucket?: string } | null> {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AGENT_AUDIO_BYTES) return null;
  const bucket = recordingsBucket();
  if (bucket) {
    const location = agentAudioObjectPath(roomId);
    const ok = await uploadStoredObject({ bucket, path: location }, bytes, AGENT_AUDIO_MIME);
    if (ok) return { storage: "gcs", location, startedAt, bucket };
    return null;
  }
  // Local development / no bucket configured: keep the file on this server.
  const location = agentAudioDiskFile(roomId);
  await fs.mkdir(path.dirname(location), { recursive: true });
  await fs.writeFile(location, bytes);
  return { storage: "local", location, startedAt };
}

/** Reads the agent audio reference out of the event log, newest first. */
export function findAgentAudio(
  events: readonly { type: string; at: string; data: Record<string, unknown> }[],
): AgentAudioRef | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "interview_audio_uploaded") continue;
    const { storage, bucket, location } = event.data;
    if (storage !== "gcs" && storage !== "local") continue;
    if (typeof location !== "string" || location.length === 0) continue;
    return {
      storage,
      bucket: typeof bucket === "string" ? bucket : undefined,
      location,
      startedAt: typeof event.data.startedAt === "string" ? event.data.startedAt : event.at,
    };
  }
  return null;
}

/** A local copy of the audio for the mixing step, downloaded when needed. */
export async function agentAudioFile(ref: AgentAudioRef, workDir: string): Promise<string | null> {
  if (ref.storage === "local") {
    try {
      return (await fs.stat(ref.location)).size > 0 ? ref.location : null;
    } catch {
      return null;
    }
  }
  const bucket = ref.bucket ?? recordingsBucket();
  if (!bucket) return null;
  const response = await fetchStoredObject({ bucket, path: ref.location });
  if (!response || !response.ok || !response.body) return null;
  const target = path.join(workDir, "agent-audio.ogg");
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}
