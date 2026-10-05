/**
 * Speech-to-text via the Web Speech API (SpeechRecognition), which runs in the
 * candidate's browser — Chrome and Edge support it; Firefox does not.
 *
 * Ominibot's API is text-only and no separate STT credentials are configured,
 * so browser-side recognition is the pipeline for v1 (documented in README).
 */

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export interface SpeechRecognitionHandlers {
  onFinalTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
  onError: (message: string) => void;
}

export interface SpeechRecognitionController {
  start(): void;
  stop(): void;
}

const RESTART_DELAY_MS = 250;

export function isSpeechRecognitionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

export function createSpeechRecognition(
  handlers: SpeechRecognitionHandlers,
): SpeechRecognitionController | null {
  if (!isSpeechRecognitionSupported()) return null;

  const ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!ctor) return null;

  const recognition = new ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let wantActive = false;
  let reportedNetworkIssue = false;
  let restartTimer: number | null = null;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const trimmed = text.trim();
        if (trimmed) handlers.onFinalTranscript(trimmed);
      } else {
        interim += text;
      }
    }
    handlers.onInterimTranscript(interim.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      wantActive = false;
      handlers.onError(
        "Speech recognition was not allowed. Allow microphone access and rejoin the room.",
      );
      return;
    }
    if (event.error === "network" && !reportedNetworkIssue) {
      reportedNetworkIssue = true;
      handlers.onError(
        "Speech recognition is unavailable right now (network error). You can continue without speaking.",
      );
    }
  };

  recognition.onend = () => {
    // The engine stops itself between results; restart while active.
    if (!wantActive || restartTimer !== null) return;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (!wantActive) return;
      try {
        recognition.start();
      } catch {
        // Starting twice is harmless and self-corrects on the next onend.
      }
    }, RESTART_DELAY_MS);
  };

  return {
    start() {
      wantActive = true;
      try {
        recognition.start();
      } catch {
        // Already running.
      }
    },
    stop() {
      wantActive = false;
      if (restartTimer !== null) {
        window.clearTimeout(restartTimer);
        restartTimer = null;
      }
      try {
        recognition.stop();
      } catch {
        // Not started.
      }
    },
  };
}