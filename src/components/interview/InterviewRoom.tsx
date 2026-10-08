"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent } from "livekit-client";
import type { LiveKitJoinCredentials } from "@/lib/livekit/client";
import {
  AI_AGENT_IDENTITY,
  AGENT_DATA_TOPIC,
  decodeAgentDataMessage,
  encodeDataMessage,
} from "@/lib/ai/agent-protocol";
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  type SpeechRecognitionController,
} from "@/lib/speech/browser-speech";
import { cancelSpeech, isSpeechSynthesisSupported, speakText } from "@/lib/speech/browser-tts";
import { startGeminiLiveVoice, type GeminiLiveVoiceHandle } from "@/lib/speech/gemini-live";
import { AgentAudioPlayer } from "@/lib/speech/agent-audio-player";
import { JoinInterviewForm } from "./JoinInterviewForm";
import { CandidateVideo } from "./CandidateVideo";
import { AiAgentVideo } from "./AiAgentVideo";
import { MediaControls } from "./MediaControls";
import { ConnectionStatus, type ConnectionStage } from "./ConnectionStatus";
import type { AiUiState } from "./AiStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";

interface InterviewRoomProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  recruiterName: string | null;
}

type Stage = "prejoin" | "connecting" | "connected" | "left" | "error";

/**
 * "agent" uses the LiveKit data-channel agent worker pipeline (default).
 * "cascade" is the agent worker speaking through Cloud TTS: audio arrives on
 * the data channel instead of browser speechSynthesis.
 * "gemini-live" streams the microphone straight to the Gemini Live API with a
 * server-issued ephemeral token; the LiveKit room then only carries the
 * candidate's camera/microphone.
 */
const RAW_VOICE_PROVIDER = process.env.NEXT_PUBLIC_VOICE_PROVIDER?.trim();
const VOICE_PROVIDER: "agent" | "cascade" | "gemini-live" =
  RAW_VOICE_PROVIDER === "cascade" || RAW_VOICE_PROVIDER === "gemini-live"
    ? RAW_VOICE_PROVIDER
    : "agent";

export function InterviewRoom({ roomId, roomTitle, candidateName, recruiterName }: InterviewRoomProps) {
  const [stage, setStage] = useState<Stage>("prejoin");
  const [failure, setFailure] = useState<string | null>(null);
  /** Issued by the email-gate verify endpoint before the room can be joined. */
  const [credentials, setCredentials] = useState<LiveKitJoinCredentials | null>(null);
  const [connectionStage, setConnectionStage] = useState<ConnectionStage>("connecting");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localTracks, setLocalTracks] = useState<{
    video: MediaStreamTrack | null;
    audio: MediaStreamTrack | null;
  }>({ video: null, audio: null });

  const [aiState, setAiState] = useState<AiUiState>("connecting");
  const [aiDetail, setAiDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  // Kept only so the unmount cleanup can stop the tracks the stream owns.
  const streamRef = useRef<MediaStream | null>(null);
  const leftIntentionallyRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionController | null>(null);
  const geminiVoiceRef = useRef<GeminiLiveVoiceHandle | null>(null);
  const audioPlayerRef = useRef<AgentAudioPlayer | null>(null);
  // Mirrors React state for use inside long-lived event handlers.
  const agentPresentRef = useRef(false);
  const speakingRef = useRef(false);

  // Cleanup when the page is closed or navigated away from.
  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      recognitionRef.current?.stop();
      cancelSpeech();
      audioPlayerRef.current?.stop();
      audioPlayerRef.current = null;
      geminiVoiceRef.current?.stop();
      geminiVoiceRef.current = null;
      void roomRef.current?.disconnect();
      roomRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  function startListeningIfReady() {
    if (agentPresentRef.current && !speakingRef.current) {
      recognitionRef.current?.start();
    }
  }

  function pauseListening() {
    recognitionRef.current?.stop();
    setInterimTranscript(null);
  }

  async function handleProceed(mediaStream: MediaStream) {
    streamRef.current = mediaStream;
    setFailure(null);
    setMuted(false);
    setCameraOff(false);
    setLocalTracks({
      video: mediaStream.getVideoTracks()[0] ?? null,
      audio: mediaStream.getAudioTracks()[0] ?? null,
    });
    setStage("connecting");
    setAiState("connecting");

    try {
      if (!credentials) {
        setFailure("This link needs email verification before it can be joined.");
        setStage("error");
        return;
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Reconnecting, () => setConnectionStage("reconnecting"));
      room.on(RoomEvent.Reconnected, () => setConnectionStage("connected"));
      room.on(RoomEvent.Disconnected, () => {
        if (leftIntentionallyRef.current) return;
        recognitionRef.current?.stop();
        cancelSpeech();
        setFailure("Your connection to the interview room was lost.");
        setStage("error");
      });

      room.on(RoomEvent.DataReceived, (payload) => {
        const message = decodeAgentDataMessage(payload);
        if (!message) return;

        if (message.type === "ai-status") {
          if (message.state === "processing") {
            pauseListening();
            setAiState("processing");
          } else if (message.state === "listening") {
            // Cascade playback may still be running; the drain callback
            // returns the state to listening when the voice has finished.
            if (!speakingRef.current && !audioPlayerRef.current?.isPlaying) {
              setAiState("listening");
            }
            startListeningIfReady();
          } else if (message.state === "error") {
            setAiState("error");
            setAiDetail(message.detail ?? null);
          } else {
            setAiState(message.state);
          }
          return;
        }

        if (message.type === "ai-audio-chunk") {
          const player = audioPlayerRef.current;
          if (!player) return;
          setAiState("speaking");
          setAiDetail(null);
          void player.enqueue(message.mimeType, message.data).catch(() => {
            // Undecodable audio must not break the interview.
          });
          return;
        }

        if (message.type === "ai-audio-end") {
          audioPlayerRef.current?.end();
          return;
        }

        // The AI's reply text: show it, speak it through this provider's
        // pipeline, and only listen again once the voice has finished.
        setTranscript((entries) => [...entries, { role: "interviewer", text: message.text }]);
        setAiDetail(null);
        speakingRef.current = true;
        setAiState("speaking");
        pauseListening();

        if (VOICE_PROVIDER === "cascade") {
          // spoken=true: the worker is streaming this reply as audio chunks,
          // so the page must stay silent (no browser speechSynthesis — two
          // voices would overlap). Without spoken the worker cannot speak and
          // the page says the reply itself, as in the default agent pipeline.
          if (message.spoken) return;
          if (isSpeechSynthesisSupported()) {
            speakText(message.text, () => {
              speakingRef.current = false;
              setAiState("listening");
              startListeningIfReady();
            });
          } else {
            speakingRef.current = false;
            setAiState("listening");
          }
          return;
        }

        if (isSpeechSynthesisSupported()) {
          speakText(message.text, () => {
            speakingRef.current = false;
            setAiState("listening");
            startListeningIfReady();
          });
        } else {
          speakingRef.current = false;
          setAiState("listening");
        }
      });

      const syncAgentPresence = (present: boolean) => {
        agentPresentRef.current = present;
        if (!present) {
          speakingRef.current = false;
          cancelSpeech();
          audioPlayerRef.current?.stop();
          recognitionRef.current?.stop();
          setAiState("disconnected");
          setInterimTranscript(null);
        } else if (!speakingRef.current) {
          setAiState("listening");
          startListeningIfReady();
        }
      };

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participant.identity === AI_AGENT_IDENTITY) syncAgentPresence(true);
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.identity === AI_AGENT_IDENTITY) syncAgentPresence(false);
      });

      await room.connect(credentials.url, credentials.token);

      const localVideoTrack = mediaStream.getVideoTracks()[0];
      if (localVideoTrack) {
        await room.localParticipant.publishTrack(localVideoTrack);
      }
      const localAudioTrack = mediaStream.getAudioTracks()[0];
      if (localAudioTrack) {
        await room.localParticipant.publishTrack(localAudioTrack);
      }

      setConnectionStage("connected");
      setStage("connected");

      // The agent may already be in the room (e.g. after rejoining).
      if (room.remoteParticipants.has(AI_AGENT_IDENTITY)) {
        syncAgentPresence(true);
      }

      if (VOICE_PROVIDER === "gemini-live") {
        // The microphone streams straight to the Gemini Live API; the LiveKit
        // room only carries the candidate's own camera and microphone.
        try {
          geminiVoiceRef.current = await startGeminiLiveVoice({
            onStatus: (state, detail) => {
              setAiState(state);
              setAiDetail(detail ?? null);
            },
            onTranscript: (role, text) =>
              setTranscript((entries) => [...entries, { role, text }]),
          });
        } catch {
          setVoiceNotice("The Gemini Live session could not start. Please try again.");
        }
        return;
      }

      if (VOICE_PROVIDER === "cascade") {
        const player = new AgentAudioPlayer();
        player.onDrained = () => {
          speakingRef.current = false;
          setAiState("listening");
          startListeningIfReady();
        };
        audioPlayerRef.current = player;
      }

      if (!isSpeechRecognitionSupported()) {
        setVoiceNotice(
          "Voice input is not available in this browser. Use Chrome or Edge to speak; you can still read the conversation here.",
        );
        return;
      }

      recognitionRef.current = createSpeechRecognition({
        onFinalTranscript: (text) => {
          setInterimTranscript(null);
          setTranscript((entries) => [...entries, { role: "candidate", text }]);
          if (!agentPresentRef.current) return;
          void room.localParticipant
            .publishData(encodeDataMessage({ type: "candidate-transcript", text }), {
              reliable: true,
              destinationIdentities: [AI_AGENT_IDENTITY],
              topic: AGENT_DATA_TOPIC,
            })
            .catch(() => setVoiceNotice("Could not send your message. Please try again."));
        },
        onInterimTranscript: (text) => setInterimTranscript(text || null),
        onError: (message) => setVoiceNotice(message),
      });
      startListeningIfReady();
    } catch (cause) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setLocalTracks({ video: null, audio: null });
      setFailure(
        cause instanceof Error
          ? cause.message
          : "Could not join the interview room. Please try again.",
      );
      setStage("error");
    }
  }

  function handleToggleMute() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const nextMuted = !muted;
    track.enabled = !nextMuted;
    setMuted(nextMuted);
  }

  function handleToggleCamera() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const nextCameraOff = !cameraOff;
    track.enabled = !nextCameraOff;
    setCameraOff(nextCameraOff);
  }

  async function handleLeave() {
    leftIntentionallyRef.current = true;
    recognitionRef.current?.stop();
    cancelSpeech();
    audioPlayerRef.current?.stop();
    audioPlayerRef.current = null;
    geminiVoiceRef.current?.stop();
    geminiVoiceRef.current = null;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLocalTracks({ video: null, audio: null });
    setStage("left");
  }

  function handleRetry() {
    leftIntentionallyRef.current = false;
    setFailure(null);
    setAiState("connecting");
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
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-[1920px] grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span className="grid size-7 place-items-center rounded-lg bg-accent text-xs text-white">I</span>
                Intervia
              </Link>
              <h1 className="mt-2 text-lg font-semibold">{roomTitle}</h1>
            </div>
            <ConnectionStatus stage={connectionStage} />
          </header>

          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <section className="min-w-0">
              <AiAgentVideo state={aiState} detail={aiDetail} />
            </section>
            <section className="min-w-0">
              <div className="relative">
                <CandidateVideo
                  track={cameraOff ? null : localTracks.video}
                  mirrored
                  label="Your camera"
                />
                <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white">
                  {candidateName || "You"}
                </span>
              </div>
            </section>
          </div>

          {voiceNotice && (
            <p role="status" className="text-xs text-muted">
              {voiceNotice}
            </p>
          )}

          <div className="mt-auto">
            <MediaControls
              muted={muted}
              cameraOff={cameraOff}
              onToggleMute={handleToggleMute}
              onToggleCamera={handleToggleCamera}
              onLeave={handleLeave}
            />
          </div>
        </section>

        <aside className="flex min-h-[22rem] flex-col gap-3 rounded-2xl border border-border bg-background p-4 lg:h-[calc(100dvh-3rem)]">
          <header>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Live interview</p>
            <h2 className="mt-1 text-lg font-semibold">Conversation</h2>
          </header>
          <TranscriptPanel entries={transcript} interim={interimTranscript} />
        </aside>
      </main>
    );
  }

  if (stage === "left") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center leading-relaxed">
          <h1 className="mb-2 text-xl font-semibold">You have left the interview</h1>
          <p className="mb-6 text-sm text-muted">
            You can rejoin while the link is still valid.
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