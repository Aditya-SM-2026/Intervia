"use client";

import { useEffect, useState } from "react";
import {
  Maximize2,
  MessageSquareText,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Sparkles,
  UserRound,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { isFullscreen, onFullscreenChange } from "@/lib/browser/fullscreen";
import type { AiUiState } from "./AiStatus";
import { CandidateVideo } from "./CandidateVideo";
import type { ConnectionStage } from "./ConnectionStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";
import { useFullscreen } from "./useFullscreen";
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
  /** True for a few seconds after HR joins the call. */
  hrNotice: boolean;
  /** HR is in the call, so their tile is shown above the candidate's. */
  hrPresent: boolean;
  /** HR's camera, when they publish one. */
  hrTrack: MediaStreamTrack | null;
  /** Set while the interview is on hold, waiting for the candidate to return. */
  pause: PauseView | null;
  onToggleConversation: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  onResume: () => void;
  onEnableAudio: () => void;
}

/** Why the interview stopped, in the candidate's own terms. */
export type PauseReason = "fullscreen" | "tab_hidden";

/** The pause as the screen shows it: a reason and a countdown. */
export interface PauseView {
  reason: PauseReason;
  secondsLeft: number;
  totalSeconds: number;
}

const PAUSE_TEXT: Record<PauseReason, string> = {
  fullscreen: "You left full screen, so the interview is on hold. The interviewer cannot hear you.",
  tab_hidden: "You left the interview window, so it is on hold. The interviewer cannot hear you.",
};

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
    ? "bg-rose-600 text-white shadow-[0_0_24px_rgba(225,29,72,0.35)] hover:bg-rose-500"
    : active === "off"
      ? "bg-white text-[#0b1640] hover:bg-white/90"
      : active === "on"
        ? "bg-[#7aa7ff]/25 text-white ring-1 ring-[#7aa7ff]/60"
        : "bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.12]";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      className={`inline-flex h-11 min-w-11 items-center justify-center rounded-full transition ${tone} ${danger ? "px-5" : ""}`}
    >
      {children}
    </button>
  );
}

/** The small name plate that sits inside each video tile. */
function TileLabel({
  name,
  muted,
}: {
  name: string;
  muted?: boolean;
}) {
  return (
    <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
      <UserRound className="size-3 text-white/70" aria-hidden />
      <span className="max-w-[10rem] truncate">{name}</span>
      {muted && <MicOff className="size-3 text-rose-300" aria-hidden />}
    </span>
  );
}

/**
 * The live call, as the candidate sees it: one dark interview window with the
 * interviewer's stage on the left and the cameras on the right. HR joins as a
 * second tile above the candidate's own camera. The dock below carries the
 * same controls as before.
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
    hrNotice,
    hrPresent,
    hrTrack,
    pause,
  } = props;
  const totalSeconds = durationMinutes * 60;
  const progress = Math.min(1, elapsedSeconds / totalSeconds);
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const lastInterviewerLine = transcript.findLast((entry) => entry.role === "interviewer")?.text ?? null;
  const shortName = candidateName?.split(" ")[0] || "You";

  // The interview runs on the whole screen, once the candidate has allowed it
  // on the join form. Leaving is handled where the call ends, not here.
  const fullscreen = useFullscreen();
  // If they leave full screen any other way (Esc, the browser's own shortcut)
  // one control brings the interview back. There is no way to leave it here.
  const [leftFullscreen, setLeftFullscreen] = useState(false);
  useEffect(() => onFullscreenChange(() => setLeftFullscreen(!isFullscreen())), []);

  return (
    <main
      data-fullscreen={fullscreen.active || undefined}
      data-paused={pause ? true : undefined}
      className={`interview-stage relative flex items-center justify-center bg-[#050b1c] p-3 sm:p-6 ${
        fullscreen.active ? "h-dvh" : "min-h-dvh"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0a132b] shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)] ${
          fullscreen.active ? "flex h-full max-w-none flex-col" : "max-w-6xl"
        }`}
      >
        {/* Window bar: brand, role, status and the clock. */}
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark href={null} size="sm" onDark />
            <span className="hidden max-w-[18rem] truncate rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-white/75 sm:inline-block">
              {roomTitle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {connectionStage !== "connected" && (
              <span role="status" className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                {connectionStage === "reconnecting" ? "Reconnecting…" : "Connecting…"}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" aria-hidden="true" />
              Recording
            </span>
            <span
              className="relative overflow-hidden rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] tabular-nums text-white/85"
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

        {hrNotice && (
          <div
            role="status"
            aria-live="polite"
            className="animate-pop-in pointer-events-none absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-400/30 bg-[#0d1838]/95 px-4 py-2 text-sm text-emerald-200 shadow-lg shadow-black/30 backdrop-blur"
          >
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
            HR joined the interview
          </div>
        )}

        <div className={`p-3 sm:p-4 ${fullscreen.active ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          <div
            className={`grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] ${
              fullscreen.active ? "min-h-0 flex-1" : ""
            }`}
          >
            {/* The interviewer's stage. */}
            <section className="relative flex min-h-[320px] flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-indigo-400/20 bg-[radial-gradient(120%_120%_at_50%_-10%,#34327a_0%,#211f54_45%,#12122f_100%)] px-6 py-8 text-center sm:min-h-[420px]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-indigo-400/20 blur-3xl"
              />
              <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-white/75">
                <Sparkles className="size-3 text-indigo-300" aria-hidden />
                AI Interviewer
              </span>

              <span
                className={`grid size-20 place-items-center rounded-full bg-gradient-to-br from-[#6d8dff] to-[#2446d8] transition-shadow duration-500 sm:size-24 ${ORB_GLOW[aiState]} ${
                  aiState === "speaking" ? "motion-safe:animate-pulse" : ""
                }`}
                aria-hidden="true"
              >
                <Mic className="size-8 text-white" />
              </span>

              <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">AI Interviewer</h2>

              <VoiceStage
                state={aiState}
                detail={aiDetail}
                interviewerTrack={interviewerTrack}
                microphoneTrack={microphoneTrack}
                muted={muted}
                onDark
                textFirst
                compact
              />

              <div className="mt-1 max-w-xl">
                <p className="line-clamp-3 text-balance text-sm font-medium leading-snug text-white/85 sm:text-[15px]">
                  {lastInterviewerLine ?? "Your interviewer will greet you in a moment."}
                </p>
                {!lastInterviewerLine && (
                  <p className="mt-1.5 text-xs text-white/50">
                    Take your time before answering. You can interrupt at any point.
                  </p>
                )}
              </div>

              {audioBlocked && (
                <button
                  type="button"
                  onClick={props.onEnableAudio}
                  className="mt-1 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#08123a] transition hover:bg-white/90"
                >
                  <Volume2 className="size-4" aria-hidden />
                  Turn on sound to hear the interviewer
                </button>
              )}
            </section>

            {/* Cameras: HR above the candidate when they are in the call. */}
            <div className="flex flex-col gap-3">
              {hrPresent && (
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0f1b45] shadow-lg shadow-black/30 lg:aspect-auto lg:min-h-0 lg:flex-1">
                  {hrTrack ? (
                    <CandidateVideo track={hrTrack} label="HR" fill />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-[radial-gradient(120%_120%_at_50%_0%,#1b2a5c_0%,#0f1b45_70%)]">
                      <span className="grid size-14 place-items-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
                        HR
                      </span>
                    </div>
                  )}
                  <TileLabel name="HR" />
                </div>
              )}

              <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0f1b45] shadow-lg shadow-black/30 lg:aspect-auto lg:min-h-0 lg:flex-1">
                <CandidateVideo
                  track={cameraOff ? null : videoTrack}
                  mirrored
                  label={candidateName || "Your camera"}
                  fill
                />
                <TileLabel name={shortName} muted={muted} />
              </div>
            </div>
          </div>

          {/* One dock, the same controls as before. */}
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 sm:mt-4">
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
            <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
            <ControlButton label="Leave the interview" danger onClick={props.onLeave}>
              <PhoneOff className="size-5" aria-hidden />
              <span className="ml-2 text-sm font-semibold">Leave</span>
            </ControlButton>
          </div>

          {leftFullscreen && !pause && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => void fullscreen.enter()}
                className="animate-pop-in inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white transition hover:bg-white/[0.12]"
              >
                <Maximize2 className="size-3.5" aria-hidden />
                Return to full screen
              </button>
            </div>
          )}
        </div>

        {showConversation && (
          <aside className="absolute inset-x-3 bottom-24 top-16 z-20 flex flex-col rounded-xl border border-white/10 bg-[#0d1838]/95 p-4 backdrop-blur sm:inset-x-auto sm:right-4 sm:top-16 sm:w-[22rem]">
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

      {pause && <PauseScreen pause={pause} onResume={props.onResume} />}
    </main>
  );
}

/**
 * The hold screen. It covers the whole interview, because there is nothing
 * left to do in it: the interviewer cannot hear the candidate and will not
 * speak until they are back, and the only way back is the button (which is
 * also the click the browser needs before it returns the screen).
 */
function PauseScreen({
  pause,
  onResume,
}: {
  pause: PauseView;
  onResume: () => void;
}) {
  const windowText =
    pause.totalSeconds >= 60
      ? `${Math.round(pause.totalSeconds / 60)} minutes`
      : `${pause.totalSeconds} seconds`;
  const remaining = Math.max(0, Math.min(1, pause.secondsLeft / pause.totalSeconds));

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="interview-paused"
      className="absolute inset-0 z-30 flex items-center justify-center bg-[#050b1c]/80 p-4 backdrop-blur-md"
    >
      <div className="animate-pop-in w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1430] p-7 text-center shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-amber-400/15 text-amber-300">
          <Pause className="size-6" fill="currentColor" aria-hidden />
        </span>
        <h2 id="interview-paused" className="mt-4 text-xl font-semibold tracking-tight text-white">
          Interview paused
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/65">
          {PAUSE_TEXT[pause.reason]}
        </p>

        <p className="mt-6 text-5xl font-semibold tabular-nums tracking-tight text-white">
          {formatClock(pause.secondsLeft)}
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/40">to come back</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <span
            aria-hidden="true"
            className="block h-full rounded-full bg-amber-400 transition-[width] duration-300 ease-linear"
            style={{ width: `${remaining * 100}%` }}
          />
        </div>

        <button
          type="button"
          onClick={onResume}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0b1640] transition hover:bg-white/90"
        >
          <Maximize2 className="size-4" aria-hidden />
          Resume the interview
        </button>
        <p className="mt-4 text-xs leading-relaxed text-white/40">
          The interview timer keeps running while you are away. If you are not back within{" "}
          {windowText}, it ends and is sent to the recruiter as it stands.
        </p>
      </div>
    </div>
  );
}
