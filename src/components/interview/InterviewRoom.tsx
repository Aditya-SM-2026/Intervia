"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent } from "livekit-client";
import { LIVEKIT_TOKEN_ENDPOINT } from "@/lib/livekit/client";
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
import { JoinInterviewForm } from "./JoinInterviewForm";
import { CandidateVideo } from "./CandidateVideo";
import { MediaControls } from "./MediaControls";
import { ConnectionStatus, type ConnectionStage } from "./ConnectionStatus";
import { AiStatus, type AiUiState } from "./AiStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";

interface InterviewRoomProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
}

type Stage = "prejoin" | "connecting" | "connected" | "left" | "error";

function failureMessage(code: string | undefined): string {
  if (code === "ROOM_EXPIRED") return "This interview link has expired.";
  if (code === "ROOM_NOT_FOUND") return "This interview link does not exist.";
  if (code === "ROOM_UNAVAILABLE") return "This interview is no longer available.";
  if (code === "INVALID_INPUT") return "This interview link is invalid.";
  return "The interview room is not available right now. Please try again shortly.";
}

export function InterviewRoom({ roomId, roomTitle, candidateName }: InterviewRoomProps) {
  const [stage, setStage] = useState<Stage>("prejoin");
  const [failure, setFailure] = useState<string | null>(null);
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
  // Mirrors React state for use inside long-lived event handlers.
  const agentPresentRef = useRef(false);
  const speakingRef = useRef(false);

  // Cleanup when the page is closed or navigated away from.
  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      recognitionRef.current?.stop();
      cancelSpeech();
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
      const response = await fetch(LIVEKIT_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(failureMessage(data?.error?.code));
      }
      const credentials = data as LiveKitJoinCredentials;

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
            if (!speakingRef.current) setAiState("listening");
            startListeningIfReady();
          } else if (message.state === "error") {
            setAiState("error");
            setAiDetail(message.detail ?? null);
          } else {
            setAiState(message.state);
          }
          return;
        }

        // The AI's reply: show it, speak it, and only listen again once the
        // voice has finished (so the AI never reacts to its own voice).
        setTranscript((entries) => [...entries, { role: "interviewer", text: message.text }]);
        setAiDetail(null);
        if (isSpeechSynthesisSupported()) {
          speakingRef.current = true;
          setAiState("speaking");
          pauseListening();
          speakText(message.text, () => {
            speakingRef.current = false;
            setAiState("listening");
            startListeningIfReady();
          });
        } else {
          setAiState("listening");
        }
      });

      const syncAgentPresence = (present: boolean) => {
        agentPresentRef.current = present;
        if (!present) {
          speakingRef.current = false;
          cancelSpeech();
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
            roomTitle={roomTitle}
            candidateName={candidateName}
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
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{roomTitle}</h1>
          <ConnectionStatus stage={connectionStage} />
        </header>

        <CandidateVideo
          track={cameraOff ? null : localTracks.video}
          mirrored
          label="Your camera"
        />

        <div className="flex flex-col items-center gap-2">
          <AiStatus state={aiState} detail={aiDetail} />
          {voiceNotice && <p className="max-w-md text-xs text-muted">{voiceNotice}</p>}
        </div>

        <TranscriptPanel entries={transcript} interim={interimTranscript} />

        <div className="mt-auto">
          <MediaControls
            muted={muted}
            cameraOff={cameraOff}
            onToggleMute={handleToggleMute}
            onToggleCamera={handleToggleCamera}
            onLeave={handleLeave}
          />
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