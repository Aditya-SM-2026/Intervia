"use client";

import { MessageSquareText, Mic, MicOff, PhoneOff, Video, VideoOff, Volume2, X } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import type { AiUiState } from "./AiStatus";
import { CandidateVideo } from "./CandidateVideo";
import type { ConnectionStage } from "./ConnectionStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";
import { VoiceStage } from "./VoiceStage";

interface LiveRoomProps {
  roomTitle: string;
  candidateName: string | null;
  durationMinutes: number;
  elapsedSeconds: number;
  connectionStage: ConnectionStage;
  aiState: AiUiState;
  aiDetail: string | null;
  interviewerTrack: MediaStreamTrack | null;
  microphoneTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  muted: boolean;
  cameraOff: boolean;
  transcript: TranscriptEntry[];
  showConversation: boolean;
  audioBlocked: boolean;
  onToggleConversation: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  onEnableAudio: () => void;
}

/** Glow around the interviewer's orb, by what is happening. */
const ORB_GLOW: Record<AiUiState, string> = {
  connecting: "shadow-[0_0_60px_rgba(141,152,179,0.35)]",
  listening: "shadow-[0_0_70px_rgba(111,211,168,0.45)]",
  processing: "shadow-[0_0_70px_rgba(250,204,21,0.35)]",
  speaking: "shadow-[0_0_90px_rgba(122,167,255,0.7)]",
  error: "shadow-[0_0_60px_rgba(240,138,138,0.5)]",
  disconnected: "shadow-[0_0_60px_rgba(240,138,138,0.5)]",
};

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ControlButton({
  label,
  active,
  danger,
  onClick,
  children,
}: {
  label: string;
  /** Highlighted: something the candidate turned off, or a panel that is open. */
  active?: "off" | "on";
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tone = danger
    ? "bg-rose-600 text-white hover:bg-rose-500"
    : active === "off"
      ? "bg-white text-[#0b1640] hover:bg-white/90"
      : active === "on"
        ? "bg-[#7aa7ff]/25 text-white ring-1 ring-[#7aa7ff]/60"
        : "bg-white/10 text-white hover:bg-white/15";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      className={`inline-flex h-12 min-w-12 items-center justify-center rounded-full transition ${tone} ${danger ? "px-5" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * The live call, as the candidate sees it: the interviewer in the centre as a
 * glowing orb with the voice line under it, the current question large enough
 * to re-read, their own camera in the corner, and one dock of controls.
 */
export function LiveRoom(props: LiveRoomProps) {
  const {
    roomTitle,
    candidateName,
    durationMinutes,
    elapsedSeconds,
    connectionStage,
    aiState,
    aiDetail,
    interviewerTrack,
    microphoneTrack,
    videoTrack,
    muted,
    cameraOff,
    transcript,
    showConversation,
    audioBlocked,
  } = props;
  const totalSeconds = durationMinutes * 60;
  const progress = Math.min(1, elapsedSeconds / totalSeconds);
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const lastInterviewerLine = transcript.findLast((entry) => entry.role === "interviewer")?.text ?? null;

  return (
    <main className="interview-stage relative isolate flex h-dvh flex-col overflow-hidden bg-[#08123a]">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_50%_0%,rgba(74,114,245,0.35),transparent_70%)]"
      />

      <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <BrandMark href={null} size="sm" onDark />
          <span className="hidden h-6 w-px bg-white/15 sm:block" aria-hidden="true" />
          <h1 className="hidden truncate text-sm text-white/70 sm:block">{roomTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          {connectionStage !== "connected" && (
            <span role="status" className="rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-medium text-amber-300">
              {connectionStage === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            </span>
          )}
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/80">
            <span className="size-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.9)]" aria-hidden="true" />
            Recording
          </span>
          <span
            className="relative overflow-hidden rounded-full bg-white/[0.07] px-3 py-1.5 text-xs tabular-nums text-white/90"
            role="progressbar"
            aria-label="Interview time used"
            aria-valuemin={0}
            aria-valuemax={durationMinutes}
            aria-valuenow={Math.min(durationMinutes, Math.floor(elapsedSeconds / 60))}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-white/10 transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
            <span className="relative">{formatClock(remaining)} left</span>
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 px-5 pb-28 sm:px-8">
          <span
            className={`grid size-20 place-items-center rounded-full bg-gradient-to-br from-[#6d8dff] to-[#2446d8] transition-shadow duration-500 sm:size-24 ${ORB_GLOW[aiState]} ${
              aiState === "speaking" ? "motion-safe:animate-pulse" : ""
            }`}
            aria-hidden="true"
          >
            <Mic className="size-8 text-white" />
          </span>

          <VoiceStage
            state={aiState}
            detail={aiDetail}
            interviewerTrack={interviewerTrack}
            microphoneTrack={microphoneTrack}
            muted={muted}
          />

          <p className="min-h-[4.5rem] max-w-2xl text-balance text-center text-xl font-medium leading-snug text-white sm:text-[26px]">
            {lastInterviewerLine ?? "Your interviewer will greet you in a moment."}
          </p>
          {!lastInterviewerLine && (
            <p className="-mt-3 text-sm text-white/55">Take your time before answering. You can interrupt at any point.</p>
          )}

          {audioBlocked && (
            <button
              type="button"
              onClick={props.onEnableAudio}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#08123a] transition hover:bg-white/90"
            >
              <Volume2 className="size-4" aria-hidden />
              Turn on sound to hear the interviewer
            </button>
          )}
        </section>

        {showConversation && (
          <aside className="absolute inset-x-3 bottom-24 top-20 z-20 flex flex-col rounded-2xl border border-white/10 bg-[#0d1838]/95 p-4 backdrop-blur sm:inset-x-auto sm:right-5 sm:w-[22rem] lg:static lg:mb-24 lg:mr-5 lg:mt-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Conversation so far</h2>
              <button
                type="button"
                onClick={props.onToggleConversation}
                aria-label="Hide the conversation"
                className="grid size-8 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <TranscriptPanel entries={transcript} interim={null} />
          </aside>
        )}
      </div>

      {/* Own camera, bottom left, above the dock on small screens. */}
      <div className="absolute bottom-24 left-4 w-32 sm:bottom-5 sm:left-6 sm:w-48">
        <CandidateVideo track={cameraOff ? null : videoTrack} mirrored label="Your camera" />
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
          {muted && <MicOff className="size-3 text-rose-300" aria-hidden />}
          {candidateName?.split(" ")[0] || "You"}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-5 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0d1838]/80 p-2 backdrop-blur">
          <ControlButton label={muted ? "Unmute microphone" : "Mute microphone"} active={muted ? "off" : undefined} onClick={props.onToggleMute}>
            {muted ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </ControlButton>
          <ControlButton
            label={cameraOff ? "Turn camera on" : "Turn camera off"}
            active={cameraOff ? "off" : undefined}
            onClick={props.onToggleCamera}
          >
            {cameraOff ? <VideoOff className="size-5" aria-hidden /> : <Video className="size-5" aria-hidden />}
          </ControlButton>
          <ControlButton
            label={showConversation ? "Hide the conversation" : "Show the conversation"}
            active={showConversation ? "on" : undefined}
            onClick={props.onToggleConversation}
          >
            <MessageSquareText className="size-5" aria-hidden />
          </ControlButton>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
          <ControlButton label="Leave the interview" danger onClick={props.onLeave}>
            <PhoneOff className="size-5" aria-hidden />
            <span className="ml-2 text-sm font-semibold">Leave</span>
          </ControlButton>
        </div>
      </div>
    </main>
  );
}
