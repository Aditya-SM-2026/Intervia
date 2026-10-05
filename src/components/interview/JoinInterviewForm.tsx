"use client";

import { useEffect, useRef, useState } from "react";

interface JoinInterviewFormProps {
  roomTitle: string;
  candidateName: string | null;
  /** Called with the acquired stream once the candidate chooses to join. */
  onProceed: (mediaStream: MediaStream) => void;
}

type DeviceError =
  | { kind: "denied"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "generic"; message: string };

const PREVIEW_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
  audio: { echoCancellation: true, noiseSuppression: true },
};

function toDeviceError(error: unknown): DeviceError {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        kind: "denied",
        message:
          "Camera or microphone access was denied. Allow access in your browser's " +
          "address-bar settings, then try again.",
      };
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return {
        kind: "not-found",
        message:
          "No camera or microphone was found. Connect a device and try again.",
      };
    }
  }
  return {
    kind: "generic",
    message: "Could not start your camera or microphone. Please try again.",
  };
}

export function JoinInterviewForm({
  roomTitle,
  candidateName,
  onProceed,
}: JoinInterviewFormProps) {
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState<DeviceError | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Once the stream is handed over to the room, unmount cleanup must not stop it.
  const handedOffRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video && preview) {
      video.srcObject = preview;
      video.play().catch(() => {});
    }
  }, [preview]);

  useEffect(() => {
    return () => {
      if (!handedOffRef.current) {
        preview?.getTracks().forEach((track) => track.stop());
      }
    };
    // The preview stream is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnableDevices() {
    setIsRequesting(true);
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError({
          kind: "unsupported",
          message:
            "This browser cannot access camera or microphone. Use a recent " +
            "Chrome, Firefox or Edge over HTTPS.",
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia(PREVIEW_CONSTRAINTS);
      handedOffRef.current = false;
      setPreview(stream);
    } catch (cause) {
      setError(toDeviceError(cause));
    } finally {
      setIsRequesting(false);
    }
  }

  function handleJoin() {
    if (!preview) return;
    handedOffRef.current = true;
    onProceed(preview);
  }

  return (
    <div className="grid gap-4 text-center">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">Intervia</p>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Interview room</p>
        <h1 className="text-2xl font-semibold">{roomTitle}</h1>
        {candidateName && (
          <p className="mt-1 text-sm">
            You are joining as <strong>{candidateName}</strong>.
          </p>
        )}
      </div>

      {preview ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Preview of your camera"
            className="-scale-x-100 aspect-video w-full bg-black object-cover"
          />
        </div>
      ) : (
        <ol className="grid list-decimal gap-1 pl-5 text-left text-sm">
          <li>Allow camera access</li>
          <li>Allow microphone access</li>
          <li>Check your preview, then join the room</li>
        </ol>
      )}

      <p className="text-xs text-muted">
        Your camera and microphone are used to show you and to let you speak with
        Intervia AI. Nothing is recorded or stored.
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error.message}
        </p>
      )}

      {preview ? (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={handleJoin}
            aria-label="Join the interview room now"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Join interview
          </button>
          <button
            type="button"
            onClick={() => {
              preview.getTracks().forEach((track) => track.stop());
              handedOffRef.current = true; // don't double-stop in cleanup
              setPreview(null);
            }}
            aria-label="Stop the camera preview and go back"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
          >
            Back
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleEnableDevices}
          disabled={isRequesting}
          aria-label="Allow camera and microphone to continue"
          className="justify-self-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRequesting ? "Waiting for permission…" : "Enable camera & microphone"}
        </button>
      )}
    </div>
  );
}