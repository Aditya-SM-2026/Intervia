"use client";

import { useEffect, useRef, useState } from "react";
import { verifyEndpoint, type LiveKitJoinCredentials } from "@/lib/livekit/client";

interface JoinInterviewFormProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  recruiterName: string | null;
  /** Called with the join credentials once the email gate passes. */
  onVerified: (credentials: LiveKitJoinCredentials) => void;
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

const fieldLabelClasses = "mb-1 block text-sm font-medium";
const fieldInputClasses =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-accent";

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
  roomId,
  roomTitle,
  candidateName,
  recruiterName,
  onVerified,
  onProceed,
}: JoinInterviewFormProps) {
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState<DeviceError | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Once the stream is handed over to the room, unmount cleanup must not stop it.
  const handedOffRef = useRef(false);

  // Email gate state: the link only proceeds after the email matches and
  // consent is given.
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) {
      setVerifyError("Please give consent to continue.");
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);

    try {
      const response = await fetch(verifyEndpoint(roomId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), consent }),
      });
      const data = await response.json();

      if (!response.ok) {
        setVerifyError(data?.error?.message ?? "Could not verify this email. Please try again.");
        return;
      }
      onVerified(data as LiveKitJoinCredentials);
      setVerified(true);
    } catch {
      setVerifyError("Could not reach the interview service. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

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

  const header = (
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
  );

  if (!verified) {
    return (
      <form onSubmit={handleVerify} className="grid gap-4 text-center">
        {header}
        <div className="grid gap-3 text-left">
          <div>
            <label htmlFor="join-email" className={fieldLabelClasses}>
              Your email address
            </label>
            <input
              id="join-email"
              type="email"
              required
              maxLength={200}
              placeholder="The email your recruiter invited"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldInputClasses}
            />
          </div>
          <label className="flex items-start gap-2 text-sm leading-relaxed">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <span>
              I give my consent for this interview to be conducted by Intervia AI
              {recruiterName ? (
                <> on behalf of <strong>{recruiterName}</strong></>
              ) : (
                <> on behalf of the recruiter</>
              )}
              , with the conversation transcribed and evaluated for this hiring decision.
            </span>
          </label>
        </div>

        {verifyError && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            {verifyError}
          </p>
        )}

        <button
          type="submit"
          disabled={isVerifying}
          aria-label="Verify email and continue to the interview"
          className="justify-self-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerifying ? "Verifying…" : "Verify and continue"}
        </button>
      </form>
    );
  }

  return (
    <div className="grid gap-4 text-center">
      {header}

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
        Email verified. Your camera and microphone are used to show you and to let
        you speak with Intervia AI. The conversation is transcribed and used to
        evaluate this interview.
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