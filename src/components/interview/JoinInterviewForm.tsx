"use client";

import { useEffect, useRef, useState } from "react";
import { verifyEndpoint, type LiveKitJoinCredentials } from "@/lib/livekit/client";
import { requestFullscreen } from "@/lib/browser/fullscreen";
import { ArrowRight, Check, FileText, Maximize2, Mic, Upload, Video } from "lucide-react";
import { MicCheck } from "./MicCheck";
import { useFullscreen } from "./useFullscreen";

interface JoinInterviewFormProps {
  roomId: string;
  recruiterName: string | null;
  /** Called with the join credentials once the email gate passes. */
  onVerified: (credentials: LiveKitJoinCredentials) => void;
  /** Called with the acquired stream once the candidate chooses to join. */
  onProceed: (mediaStream: MediaStream) => void;
  /** Design preview only: start on the camera step. */
  startVerified?: boolean;
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

const fieldLabelClasses = "mb-1.5 block text-sm font-medium";
const fieldInputClasses =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10";

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
  recruiterName,
  onVerified,
  onProceed,
  startVerified = false,
}: JoinInterviewFormProps) {
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState<DeviceError | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Once the stream is handed over to the room, unmount cleanup must not stop it.
  const handedOffRef = useRef(false);

  // Third permission, asked beside camera and microphone: the interview runs
  // full screen, and only after the candidate allows it does the call take
  // over the screen. Browsers that cannot do it never see the ask.
  const { supported: fullscreenSupported } = useFullscreen();
  const [fullscreenAllowed, setFullscreenAllowed] = useState(false);

  // Email gate state: the link only proceeds after the email matches and
  // consent is given.
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(startVerified);
  // Optional updated resume: replaces the recruiter's copy in the session data.
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const MAX_RESUME_BYTES = 10 * 1024 * 1024;

  function handleResumeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setVerifyError(null);
    if (file && file.size > MAX_RESUME_BYTES) {
      setVerifyError("The resume file is larger than 10 MB.");
      event.target.value = "";
      setResumeFile(null);
      return;
    }
    setResumeFile(file);
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) {
      setVerifyError("Please give consent to continue.");
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);

    try {
      const form = new FormData();
      form.set("email", email.trim().toLowerCase());
      form.set("consent", String(consent));
      if (resumeFile) form.set("resume", resumeFile);
      const response = await fetch(verifyEndpoint(roomId), {
        method: "POST",
        body: form,
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
    // This click is the gesture the Fullscreen API needs, so allowing it here
    // means the call opens on the whole screen by itself.
    if (fullscreenAllowed) void requestFullscreen();
    onProceed(preview);
  }

  const stepLabels = fullscreenSupported
    ? ["Confirm it's you", "Camera and mic", "Full screen"]
    : ["Confirm it's you", "Camera and microphone"];
  const stepDone = [verified, Boolean(preview), fullscreenAllowed];
  const currentStep = stepDone.findIndex((done) => !done);

  const steps = (
    <ol
      className={`mb-6 grid gap-2 text-xs font-medium ${stepLabels.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
      aria-label="Steps to join"
    >
      {stepLabels.map((label, index) => {
        const done = stepDone[index];
        const current = index === currentStep;
        return (
          <li key={label} className="grid gap-2">
            <span className={`h-1 rounded-full ${done || current ? "bg-accent" : "bg-foreground/10"}`} />
            <span className={`flex items-center gap-1.5 ${current ? "text-foreground" : "text-muted"}`}>
              {done ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <span className="tabular-nums">{index + 1}.</span>}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  if (!verified) {
    return (
      <form onSubmit={handleVerify} className="grid gap-5">
        {steps}
        <div>
          <label htmlFor="join-email" className={fieldLabelClasses}>
            Your email address
          </label>
          <input
            id="join-email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            placeholder="The address your invitation was sent to"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldInputClasses}
          />
        </div>

        <div>
          <span className={fieldLabelClasses}>
            Newer resume <span className="font-normal text-muted">(optional)</span>
          </span>
          <label
            htmlFor="join-resume"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-sm transition hover:border-accent/60 hover:bg-accent-soft/40"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              {resumeFile ? <FileText className="size-4" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{resumeFile ? resumeFile.name : "Choose a file"}</span>
              <span className="block text-xs text-muted">
                {resumeFile ? "Replaces the resume we already have" : "PDF, DOC or DOCX, up to 10 MB"}
              </span>
            </span>
            <input
              id="join-resume"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              onChange={handleResumeChange}
              className="sr-only"
            />
          </label>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl bg-foreground/[0.03] p-3.5 text-xs leading-relaxed text-muted">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>
            I agree to this interview being conducted by an AI interviewer
            {recruiterName ? (
              <> on behalf of <strong className="text-foreground">{recruiterName}</strong></>
            ) : (
              <> on behalf of the recruiter</>
            )}
            . The audio and video are recorded and transcribed, an AI system assesses my answers, and a person at the
            hiring company makes the final decision. I can ask the recruiter to delete my recording and data.
          </span>
        </label>

        {verifyError && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {verifyError}
          </p>
        )}

        <button
          type="submit"
          disabled={isVerifying}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerifying ? "CheckingΓÇª" : "Continue"}
          {!isVerifying && <ArrowRight className="size-4" aria-hidden />}
        </button>
      </form>
    );
  }

  return (
    <div className="grid gap-5">
      {steps}

      <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900">
        {preview ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Preview of your camera"
              className="size-full -scale-x-100 object-cover"
            />
            {preview.getAudioTracks()[0] && (
              <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/55 px-3 py-2 text-white backdrop-blur">
                <MicCheck track={preview.getAudioTracks()[0]} />
              </div>
            )}
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 p-4 text-center text-white">
            <span className="flex gap-2">
              <span className="grid size-11 place-items-center rounded-full bg-white/10">
                <Video className="size-5" aria-hidden />
              </span>
              <span className="grid size-11 place-items-center rounded-full bg-white/10">
                <Mic className="size-5" aria-hidden />
              </span>
            </span>
            <button
              type="button"
              onClick={handleEnableDevices}
              disabled={isRequesting}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white/90 disabled:opacity-60"
            >
              {isRequesting ? "Waiting for permissionΓÇª" : "Turn on camera and microphone"}
            </button>
            <span className="text-xs text-white/60">Your browser will ask for permission.</span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}

      {fullscreenSupported && (
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition ${
            fullscreenAllowed
              ? "border-emerald-500/40 bg-emerald-500/[0.06]"
              : "border-border hover:border-accent/60 hover:bg-accent-soft/40"
          }`}
        >
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-lg ${
              fullscreenAllowed ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-accent/10 text-accent"
            }`}
          >
            <Maximize2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Full screen
              {fullscreenAllowed && <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
            </span>
            <span className="block text-xs leading-relaxed text-muted">
              {fullscreenAllowed
                ? "Allowed. The interview fills your screen when you join."
                : "Allow the interview to fill your whole screen. It leaves full screen by itself when the interview ends."}
            </span>
          </span>
          <input
            type="checkbox"
            checked={fullscreenAllowed}
            onChange={(event) => setFullscreenAllowed(event.target.checked)}
            aria-label="Allow full screen for this interview"
            className="size-4 shrink-0 accent-accent"
          />
        </label>
      )}

      <button
        type="button"
        onClick={handleJoin}
        disabled={!preview || (fullscreenSupported && !fullscreenAllowed)}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Join the interview
        <ArrowRight className="size-4" aria-hidden />
      </button>
      <p className="-mt-2 text-center text-xs text-muted">
        {fullscreenSupported && !fullscreenAllowed ? "Allow full screen to join." : "Recording starts when you join."}
      </p>
    </div>
  );
}
