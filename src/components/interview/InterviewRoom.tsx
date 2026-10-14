"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DisconnectReason,
  ParticipantKind,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import type { LiveKitJoinCredentials } from "@/lib/livekit/client";
import { startCandidateRecorder, type CandidateRecorder } from "@/lib/recordings/candidate-recorder";
import { JoinInterviewForm } from "./JoinInterviewForm";
import { CandidateVideo } from "./CandidateVideo";
import { VoiceStage } from "./VoiceStage";
import { MediaControls } from "./MediaControls";
import { ConnectionStatus, type ConnectionStage } from "./ConnectionStatus";
import type { AiUiState } from "./AiStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";

interface InterviewRoomProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  recruiterName: string | null;
  durationMinutes: number;
}

type Stage = "prejoin" | "connecting" | "connected" | "ended" | "left" | "error";

/** Text-stream topics: live captions from the agent, browser events to it. */
const TRANSCRIPTION_TOPIC = "lk.transcription";
const CLIENT_EVENT_TOPIC = "intervia.client";
/** Participant attribute the agent framework publishes its state on. */
const AGENT_STATE_ATTRIBUTE = "lk.agent.state";
/** If no interviewer has joined after this long, say so instead of waiting silently. */
const AGENT_JOIN_TIMEOUT_MS = 30_000;

function toAiState(agentState: string | undefined): AiUiState {
  switch (agentState) {
    case "speaking":
      return "speaking";
    case "thinking":
      return "processing";
    case "listening":
    case "idle":
      return "listening";
    default:
      return "connecting";
  }
}

/**
 * The live interview. The candidate's microphone and camera are published to
 * the LiveKit room as ordinary WebRTC tracks; the interviewer agent hears the
 * audio track on the server and answers on its own audio track. Nothing is
 * recognized or synthesized in the browser, so this works in any browser
 * with WebRTC, with the browser's echo cancellation applied to the mic.
 */
export function InterviewRoom({
  roomId,
  roomTitle,
  candidateName,
  recruiterName,
  durationMinutes,
}: InterviewRoomProps) {
  const [stage, setStage] = useState<Stage>("prejoin");
  const [failure, setFailure] = useState<string | null>(null);
  /** Issued by the email-gate verify endpoint before the room can be joined. */
  const [credentials, setCredentials] = useState<LiveKitJoinCredentials | null>(null);
  const [connectionStage, setConnectionStage] = useState<ConnectionStage>("connecting");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [microphoneTrack, setMicrophoneTrack] = useState<MediaStreamTrack | null>(null);
  const [interviewerTrack, setInterviewerTrack] = useState<MediaStreamTrack | null>(null);
  const [showConversation, setShowConversation] = useState(false);
  const [aiState, setAiState] = useState<AiUiState>("connecting");
  const [aiDetail, setAiDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const publicationsRef = useRef<{
    audio: LocalTrackPublication | null;
    video: LocalTrackPublication | null;
  }>({ audio: null, video: null });
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const recorderRef = useRef<CandidateRecorder | null>(null);
  const leftIntentionallyRef = useRef(false);
  const agentJoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Server-side deadline. The interviewer agent normally ends the interview;
   * if it never joins (or hangs), the candidate's session must still end when
   * the time budget is spent, so the recording finalises and the report is
   * generated. A minute of grace lets a present agent say goodbye first.
   */
  const hardStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function releaseMedia() {
    if (agentJoinTimerRef.current) clearTimeout(agentJoinTimerRef.current);
    agentJoinTimerRef.current = null;
    if (hardStopTimerRef.current) clearTimeout(hardStopTimerRef.current);
    hardStopTimerRef.current = null;
    // Stop recording before the tracks end, so the last piece is uploaded.
    // The upload finishes in the background; this page stays open after an
    // interview, on the "complete" screen.
    void recorderRef.current?.stop();
    recorderRef.current = null;
    audioElementsRef.current.forEach((element) => element.remove());
    audioElementsRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    publicationsRef.current = { audio: null, video: null };
    setVideoTrack(null);
    setMicrophoneTrack(null);
    setInterviewerTrack(null);
  }

  // Cleanup when the page is closed or navigated away from.
  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      void roomRef.current?.disconnect();
      roomRef.current = null;
      releaseMedia();
    };
  }, []);

  // Interview clock, started when the interviewer first speaks.
  useEffect(() => {
    if (stage !== "connected" || startedAtMs === null) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [stage, startedAtMs]);

  // Tab and window focus changes are reported to the agent, which logs them
  // with timestamps for the recruiter's integrity view.
  useEffect(() => {
    if (stage !== "connected") return;
    const send = (type: string) => {
      const room = roomRef.current;
      if (!room || room.state !== "connected") return;
      void room.localParticipant
        .sendText(JSON.stringify({ type }), { topic: CLIENT_EVENT_TOPIC })
        .catch(() => {});
    };
    const onVisibility = () => send(document.hidden ? "tab_hidden" : "tab_visible");
    const onBlur = () => send("window_blur");
    const onFocus = () => send("window_focus");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [stage]);

  function upsertTranscript(entry: TranscriptEntry & { id: string }) {
    setTranscript((current) => {
      const index = current.findIndex((item) => item.id === entry.id);
      if (index === -1) return [...current, entry];
      const next = [...current];
      next[index] = entry;
      return next;
    });
  }

  function wireRoom(room: Room) {
    const isAgent = (participant: RemoteParticipant) =>
      participant.kind === ParticipantKind.AGENT;

    const onAgentPresent = (participant: RemoteParticipant) => {
      if (agentJoinTimerRef.current) clearTimeout(agentJoinTimerRef.current);
      agentJoinTimerRef.current = null;
      setAiDetail(null);
      setAiState(toAiState(participant.attributes[AGENT_STATE_ATTRIBUTE]));
    };

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (isAgent(participant)) onAgentPresent(participant);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (isAgent(participant)) setAiState("disconnected");
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (participant.isLocal || !(AGENT_STATE_ATTRIBUTE in changed)) return;
      const next = toAiState(changed[AGENT_STATE_ATTRIBUTE]);
      setAiState(next);
      if (next === "speaking") setStartedAtMs((current) => current ?? Date.now());
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.style.display = "none";
      document.body.appendChild(element);
      audioElementsRef.current.push(element);
      setInterviewerTrack(track.mediaStreamTrack);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((element) => {
        element.remove();
        audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
      });
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      setAudioBlocked(!room.canPlaybackAudio);
    });

    room.on(RoomEvent.Reconnecting, () => setConnectionStage("reconnecting"));
    room.on(RoomEvent.Reconnected, () => setConnectionStage("connected"));
    room.on(RoomEvent.Disconnected, (reason) => {
      roomRef.current = null;
      releaseMedia();
      if (leftIntentionallyRef.current) return;
      // The interviewer closes the room when the interview is over.
      if (reason === DisconnectReason.ROOM_DELETED) {
        setStage("ended");
        return;
      }
      setFailure("The connection to the interview was lost. You can rejoin with the same link.");
      setStage("error");
    });

    // Live captions for both sides, published by the agent as text streams.
    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participantInfo) => {
      const attributes = reader.info.attributes ?? {};
      const id = attributes["lk.segment_id"] || reader.info.id;
      const role: TranscriptEntry["role"] =
        participantInfo.identity === room.localParticipant.identity ? "candidate" : "interviewer";
      let text = "";
      try {
        for await (const chunk of reader) {
          text += chunk;
          if (text.trim()) upsertTranscript({ id, role, text: text.trim() });
        }
      } catch {
        // A dropped caption stream only affects the on-screen transcript.
      }
    });
  }

  async function handleProceed(stream: MediaStream) {
    if (!credentials) {
      setFailure("Your email has not been verified. Please start again.");
      setStage("error");
      return;
    }

    leftIntentionallyRef.current = false;
    streamRef.current = stream;
    setStage("connecting");
    setConnectionStage("connecting");
    setTranscript([]);
    setStartedAtMs(null);
    setElapsedSeconds(0);
    setMuted(false);
    setCameraOff(false);

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    wireRoom(room);

    try {
      await room.connect(credentials.url, credentials.token);
      const audio = stream.getAudioTracks()[0];
      const video = stream.getVideoTracks()[0];
      if (!audio) throw new Error("No microphone track is available.");

      publicationsRef.current.audio = await room.localParticipant.publishTrack(audio, {
        source: Track.Source.Microphone,
      });
      setMicrophoneTrack(audio);
      if (video) {
        publicationsRef.current.video = await room.localParticipant.publishTrack(video, {
          source: Track.Source.Camera,
        });
        setVideoTrack(video);
      }

      // The candidate's own camera and microphone are recorded here in the
      // browser, for the recruiter to replay and for the on-camera analysis.
      if (credentials.recordingToken) {
        recorderRef.current = startCandidateRecorder(stream, {
          roomId,
          recordingId: credentials.identity,
          token: credentials.recordingToken,
        });
      }

      // Joining was a click, so audio playback is normally allowed already.
      await room.startAudio().catch(() => {});
      setAudioBlocked(!room.canPlaybackAudio);

      const agent = [...room.remoteParticipants.values()].find(
        (participant) => participant.kind === ParticipantKind.AGENT,
      );
      if (agent) {
        setAiState(toAiState(agent.attributes[AGENT_STATE_ATTRIBUTE]));
      } else {
        setAiState("connecting");
        agentJoinTimerRef.current = setTimeout(() => {
          setAiState("error");
          setAiDetail(
            "The interviewer has not joined yet. Please wait a moment, or leave and rejoin.",
          );
        }, AGENT_JOIN_TIMEOUT_MS);
      }

      setConnectionStage("connected");
      setStage("connected");

      hardStopTimerRef.current = setTimeout(() => {
        hardStopTimerRef.current = null;
        const live = roomRef.current;
        if (!live) return;
        leftIntentionallyRef.current = true;
        roomRef.current = null;
        void live.disconnect().catch(() => {});
        releaseMedia();
        setStage("ended");
      }, durationMinutes * 60_000 + 60_000);
    } catch (cause) {
      leftIntentionallyRef.current = true;
      await room.disconnect().catch(() => {});
      roomRef.current = null;
      releaseMedia();
      setFailure(
        cause instanceof Error && cause.message
          ? `Could not join the interview: ${cause.message}`
          : "Could not join the interview. Please try again.",
      );
      setStage("error");
    }
  }

  async function handleToggleMute() {
    const publication = publicationsRef.current.audio;
    if (!publication) return;
    if (muted) await publication.unmute();
    else await publication.mute();
    setMuted(!muted);
  }

  async function handleToggleCamera() {
    const publication = publicationsRef.current.video;
    if (!publication) return;
    if (cameraOff) await publication.unmute();
    else await publication.mute();
    setCameraOff(!cameraOff);
  }

  async function handleLeave() {
    leftIntentionallyRef.current = true;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    releaseMedia();
    setStage("left");
  }

  function handleRetry() {
    leftIntentionallyRef.current = false;
    setFailure(null);
    setAiState("connecting");
    setAiDetail(null);
    // Join credentials are single-room and short-lived; verify again.
    setCredentials(null);
    setStage("prejoin");
  }

  if (stage === "prejoin") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 leading-relaxed">
          <JoinInterviewForm
            roomId={roomId}
            roomTitle={roomTitle}
            candidateName={candidateName}
            recruiterName={recruiterName}
            durationMinutes={durationMinutes}
            onVerified={setCredentials}
            onProceed={handleProceed}
          />
        </div>
      </main>
    );
  }

  if (stage === "connecting") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
          <ConnectionStatus stage="connecting" />
          <p className="mt-4 text-sm">Joining “{roomTitle}”…</p>
        </div>
      </main>
    );
  }

  if (stage === "connected") {
    const totalSeconds = durationMinutes * 60;
    const progress = Math.min(1, elapsedSeconds / totalSeconds);
    // What the interviewer last said, kept on screen so a question can be re-read.
    const lastInterviewerLine =
      transcript.findLast((entry) => entry.role === "interviewer")?.text ?? null;

    return (
      <main className="interview-stage flex min-h-dvh flex-col">
        <div
          className="h-1 w-full bg-border"
          role="progressbar"
          aria-label="Interview time used"
          aria-valuemin={0}
          aria-valuemax={durationMinutes}
          aria-valuenow={Math.min(durationMinutes, Math.floor(elapsedSeconds / 60))}
        >
          <div
            className="h-full bg-accent transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">Intervia</p>
            <h1 className="truncate text-sm text-muted">{roomTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums text-muted" aria-label="Interview time elapsed">
              {formatClock(elapsedSeconds)} of {durationMinutes} min
            </span>
            <ConnectionStatus stage={connectionStage} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-8 px-5 py-6 sm:px-8">
            <VoiceStage
              state={aiState}
              detail={aiDetail}
              interviewerTrack={interviewerTrack}
              microphoneTrack={microphoneTrack}
              muted={muted}
            />

            <p
              className="min-h-[4.5rem] max-w-2xl text-balance text-center text-xl leading-snug sm:text-2xl"
              aria-live="off"
            >
              {lastInterviewerLine ?? "Your interviewer will greet you in a moment."}
            </p>

            {audioBlocked && (
              <button
                type="button"
                onClick={() => {
                  void roomRef.current?.startAudio().then(() => setAudioBlocked(false));
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#0e1420] transition hover:opacity-90"
              >
                Turn on sound to hear the interviewer
              </button>
            )}
          </section>

          {showConversation && (
            <aside className="flex max-h-[45dvh] w-full flex-col gap-3 border-t border-border bg-surface p-4 lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0">
              <h2 className="text-sm font-semibold">Conversation so far</h2>
              <TranscriptPanel entries={transcript} interim={null} />
            </aside>
          )}
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-4 px-5 pb-5 sm:px-8">
          <div className="relative w-36 sm:w-44">
            <CandidateVideo track={cameraOff ? null : videoTrack} mirrored label="Your camera" />
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
              {candidateName || "You"}
            </span>
          </div>

          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-muted">
              Take your time to think. You can interrupt at any point. This interview is recorded.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConversation((shown) => !shown)}
                aria-pressed={showConversation}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
              >
                {showConversation ? "Hide conversation" : "Show conversation"}
              </button>
              <MediaControls
                muted={muted}
                cameraOff={cameraOff}
                onToggleMute={handleToggleMute}
                onToggleCamera={handleToggleCamera}
                onLeave={handleLeave}
              />
            </div>
          </div>
        </footer>
      </main>
    );
  }

  if (stage === "ended") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
          <h1 className="mb-2 text-xl font-semibold">Interview complete</h1>
          <p className="text-sm text-muted">
            Thank you{candidateName ? `, ${candidateName.split(" ")[0]}` : ""}. Your interview has
            been submitted{recruiterName ? ` to ${recruiterName}` : ""}, who will be in touch about
            next steps. You can close this page.
          </p>
        </div>
      </main>
    );
  }

  if (stage === "left") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
          <h1 className="mb-2 text-xl font-semibold">You have left the interview</h1>
          <p className="mb-6 text-sm text-muted">
            If that was a mistake, rejoin now: the interviewer waits a short while before
            closing the interview.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              aria-label="Rejoin the interview room"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Join again
            </button>
            <Link
              href="/"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
            >
              Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // stage === "error"
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
        <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
        <p role="alert" className="mb-6 text-sm">
          {failure ?? "An unexpected error occurred."}
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Try joining the interview room again"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
