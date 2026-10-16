import "server-only";
import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Candidate recordings on this server's disk.
 *
 * The candidate's browser records their own camera and microphone and uploads
 * the file in small pieces while the interview runs (see
 * src/lib/recordings/candidate-recorder.ts). Only the candidate is recorded;
 * the interviewer's words are in the transcript. Files live under
 * RECORDINGS_DIR (default .data/recordings) and are only ever served through
 * the recruiter-only playback route.
 *
 * A browser recording has no index, so it cannot be seeked. Once it is
 * complete it is rewritten once ("play" copy) with ffmpeg, which adds one.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_RECORDING_BYTES = 800 * 1024 * 1024;
const FINISHED_WAIT_MS = 25_000;
const UNFINISHED_AFTER_MS = 60_000;

export { formatFromMime, mimeFor } from "./recording-format";
import type { RecordingFormat } from "./recording-format";

export interface LocalRecording {
  roomId: string;
  recordingId: string;
  format: RecordingFormat;
}

function recordingsDir(): string {
  return process.env.RECORDINGS_DIR?.trim() || path.join(process.cwd(), ".data", "recordings");
}
export { recordingsDir };

function assertSafe(recording: LocalRecording): void {
  if (!SAFE_ID.test(recording.roomId) || !SAFE_ID.test(recording.recordingId)) {
    throw new Error("Invalid recording identifier.");
  }
}

function rawPath(recording: LocalRecording): string {
  assertSafe(recording);
  return path.join(recordingsDir(), recording.roomId, `${recording.recordingId}.${recording.format}`);
}

function playPath(recording: LocalRecording): string {
  assertSafe(recording);
  return path.join(
    recordingsDir(),
    recording.roomId,
    `${recording.recordingId}.play.${recording.format}`,
  );
}

function donePath(recording: LocalRecording): string {
  return `${rawPath(recording)}.done`;
}

export async function sizeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return -1;
  }
}

export type AppendResult =
  | { ok: true; size: number; first: boolean }
  | { ok: false; reason: "offset_mismatch" | "too_large"; size: number };

/**
 * Appends one uploaded piece. `offset` is how many bytes the browser has sent
 * before this piece: it must match the file, so pieces can never be written
 * out of order, and a piece that was already written (a retry) is accepted.
 */
export async function appendRecordingChunk(
  recording: LocalRecording,
  offset: number,
  bytes: Uint8Array,
): Promise<AppendResult> {
  const file = rawPath(recording);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const size = Math.max(0, await sizeOf(file));
  if (offset + bytes.byteLength <= size) return { ok: true, size, first: false };
  if (offset !== size) return { ok: false, reason: "offset_mismatch", size };
  if (size + bytes.byteLength > MAX_RECORDING_BYTES) return { ok: false, reason: "too_large", size };
  await fs.appendFile(file, bytes);
  return { ok: true, size: size + bytes.byteLength, first: size === 0 };
}

export async function markRecordingFinished(recording: LocalRecording): Promise<void> {
  await fs.writeFile(donePath(recording), new Date().toISOString());
}

export async function recordingSize(recording: LocalRecording): Promise<number> {
  return Math.max(0, await sizeOf(rawPath(recording)));
}

/**
 * Waits for the browser's last piece. The room closes a moment before the
 * final upload lands, so scoring would otherwise read a truncated file.
 */
export async function waitForRecordingFinished(recording: LocalRecording): Promise<void> {
  const deadline = Date.now() + FINISHED_WAIT_MS;
  let lastSize = -2;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    if ((await sizeOf(donePath(recording))) >= 0) return;
    const size = await sizeOf(rawPath(recording));
    if (size !== lastSize) {
      lastSize = size;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 12_000) {
      return; // The page was closed without a final piece; use what arrived.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

// --- ffmpeg ---------------------------------------------------------------

let cachedFfmpeg: string | null | undefined;

export function ffmpegPath(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return (cachedFfmpeg = fromEnv);
  try {
    const found = createRequire(path.join(process.cwd(), "package.json"))("ffmpeg-static") as
      | string
      | null;
    cachedFfmpeg = typeof found === "string" && found ? found : null;
  } catch {
    cachedFfmpeg = null;
  }
  return cachedFfmpeg;
}

/** Runs ffmpeg; resolves with its log (stderr). Rejects on a non-zero exit. */
export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<string> {
  const binary = ffmpegPath();
  if (!binary) return Promise.reject(new Error("ffmpeg is not available on this server."));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    child.stderr.on("data", (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-20_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(`ffmpeg exited with ${code}: ${log.slice(-400)}`));
    });
  });
}

const finalizing = new Map<string, Promise<string>>();

/**
 * The file to play or analyse: the seekable copy when it can be made, else
 * the raw upload. Safe to call repeatedly and concurrently.
 */
export async function playableRecordingFile(recording: LocalRecording): Promise<string | null> {
  const raw = rawPath(recording);
  const rawSize = await sizeOf(raw);
  if (rawSize <= 0) return null;
  const play = playPath(recording);
  if ((await sizeOf(play)) > 0) return play;
  // Only rewrite a finished recording; a live one is still growing. A file
  // that has not grown for a minute was left unfinished (the page was closed).
  const finished =
    (await sizeOf(donePath(recording))) >= 0 ||
    Date.now() - (await fs.stat(raw)).mtimeMs > UNFINISHED_AFTER_MS;
  if (!finished || !ffmpegPath()) return raw;

  const key = raw;
  let running = finalizing.get(key);
  if (!running) {
    running = (async () => {
      const temporary = `${play}.tmp.${recording.format}`;
      try {
        await runFfmpeg([
          "-y",
          "-i",
          raw,
          "-c",
          "copy",
          ...(recording.format === "mp4" ? ["-movflags", "+faststart"] : []),
          temporary,
        ]);
        await fs.rename(temporary, play);
        return play;
      } catch (error) {
        console.error(
          `[recording] could not make a seekable copy: ${error instanceof Error ? error.message : String(error)}`,
        );
        await fs.rm(temporary, { force: true });
        return raw;
      }
    })().finally(() => finalizing.delete(key));
    finalizing.set(key, running);
  }
  return running;
}

/** Length of a media file in seconds, read from ffmpeg's description of it. */
export async function mediaDurationSeconds(file: string): Promise<number | null> {
  try {
    // With no output file ffmpeg prints the input's details and exits non-zero.
    await runFfmpeg(["-i", file], 30_000);
    return null;
  } catch (error) {
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(
      error instanceof Error ? error.message : "",
    );
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
}

/** A web Response body for a file, or a byte range of it. */
export async function fileResponse(
  file: string,
  contentType: string,
  rangeHeader: string | null,
): Promise<Response> {
  const size = await sizeOf(file);
  if (size < 0) return new Response(null, { status: 404 });
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Candidate video: never stored by shared caches.
    "Cache-Control": "private, no-store",
  });

  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (!Number.isFinite(start) || start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    start = Math.max(0, start);
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    status: 200,
    headers,
  });
}
