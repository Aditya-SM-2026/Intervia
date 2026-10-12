/**
 * Records the candidate's own camera and microphone in their browser and
 * uploads the file a few seconds at a time, so that almost nothing is lost if
 * the page is closed. Only the candidate is recorded.
 *
 * Browser-only module (MediaRecorder).
 */

const TIMESLICE_MS = 4_000;
const VIDEO_BITS_PER_SECOND = 350_000;
const AUDIO_BITS_PER_SECOND = 48_000;
const MAX_ATTEMPTS = 4;

const MIME_CANDIDATES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
  "video/mp4",
];

export interface CandidateRecorderOptions {
  roomId: string;
  /** The participant identity; names the file on the server. */
  recordingId: string;
  token: string;
}

export interface CandidateRecorder {
  /** Stops recording and resolves once the last piece has been uploaded. */
  stop: () => Promise<void>;
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

/** Returns null when this browser cannot record (the interview still runs). */
export function startCandidateRecorder(
  stream: MediaStream,
  options: CandidateRecorderOptions,
): CandidateRecorder | null {
  const mimeType = pickMimeType();
  if (!mimeType || stream.getVideoTracks().length === 0) return null;

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
  } catch {
    return null;
  }

  const startedAt = Date.now();
  const endpoint = `/api/interviews/${encodeURIComponent(options.roomId)}/recording`;
  const contentType = mimeType.split(";")[0];
  let offset = 0;
  let failed = false;
  // Pieces are sent strictly one after another, in order.
  let queue: Promise<void> = Promise.resolve();

  async function send(piece: Blob, final: boolean): Promise<void> {
    if (failed) return;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${endpoint}?offset=${offset}${final ? "&final=1" : ""}`, {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "x-recording-id": options.recordingId,
            "x-recording-token": options.token,
            "x-recording-elapsed-ms": String(Date.now() - startedAt),
          },
          body: piece,
        });
        if (response.ok) {
          offset += piece.size;
          return;
        }
        // Rejected for good (not authorised, too large, out of order).
        if (response.status < 500) break;
      } catch {
        // Network blip: wait and retry the same piece.
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
    failed = true;
  }

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size === 0) return;
    const piece = event.data;
    queue = queue.then(() => send(piece, false));
  });

  let stopped: Promise<void> | null = null;
  const finished = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => {
      // The final "dataavailable" has been queued by now; close the file after it.
      queue = queue.then(() => send(new Blob([], { type: contentType }), true));
      void queue.then(resolve);
    });
  });

  try {
    recorder.start(TIMESLICE_MS);
  } catch {
    return null;
  }

  return {
    stop() {
      if (!stopped) {
        stopped = finished;
        if (recorder.state !== "inactive") recorder.stop();
      }
      return stopped;
    },
  };
}
