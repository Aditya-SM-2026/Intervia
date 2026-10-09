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
import { SentenceAssembler } from "@/lib/speech/sentence-assembler";
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
  const assemblerRef = useRef<SentenceAssembler | null>(null);
  // Mirrors React state for use inside long-lived event handlers.
  const agentPresentRef = useRef(false);
  const speakingRef = useRef(false);
  /** Reply the page is currently playing/speaking (for stale-piece filtering). */
  const currentReplyIdRef = useRef<number | null>(null);
  /** Last two agent utterances, for echo detection when the candidate barges in. */
  const agentReplyHistoryRef = useRef<string[]>([]);
  /** Final transcript fragments staged during a thinking pause, not yet sent. */
  const stagedTranscriptRef = useRef<string | null>(null);
  /** Timer that publishes the staged transcript when the pause outlasts it. */
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup when the page is closed or navigated away from.
  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      recognitionRef.current?.stop();
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
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
    // Cascade keeps the recognizer live even while the agent speaks or thinks:
    // the candidate can barge in mid-sentence. Other providers pause the mic
    // during playback so it cannot hear the page speaking.
    const canListen =
      VOICE_PROVIDER === "cascade" || !speakingRef.current;
    if (agentPresentRef.current && canListen) {
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
            // Cascade keeps the mic live so the candidate can interrupt even
            // while the agent is thinking; other providers pause listening.
            if (VOICE_PROVIDER !== "cascade") pauseListening();
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
          // Chunks of a reply that was interrupted meanwhile are stale.
          if (
            message.replyId !== undefined &&
            currentReplyIdRef.current !== null &&
            message.replyId !== currentReplyIdRef.current
          ) {
            return;
          }
          const player = audioPlayerRef.current;
          const assembler = assemblerRef.current;
          if (!player || !assembler) return;
          setAiState("speaking");
          setAiDetail(null);
          // A sentence may arrive split across chunks; only a complete
          // sentence (reassembled, in order) goes to the player.
          assembler.add(
            message.sentence ?? message.seq,
            message.piece,
            message.pieces,
            message.mimeType,
            message.data,
          );
          return;
        }

        if (message.type === "ai-audio-end") {
          if (
            message.replyId !== undefined &&
            currentReplyIdRef.current !== null &&
            message.replyId !== currentReplyIdRef.current
          ) {
            return;
          }
          audioPlayerRef.current?.end();
          return;
        }

        // The AI's reply text: show it, speak it through this provider's
        // pipeline, and only listen again once the voice has finished.
        setTranscript((entries) => [...entries, { role: "interviewer", text: message.text }]);
        setAiDetail(null);
        agentReplyHistoryRef.current = [message.text, ...agentReplyHistoryRef.current].slice(0, 2);
        currentReplyIdRef.current = message.replyId ?? null;
        assemblerRef.current?.reset();
        speakingRef.current = true;
        setAiState("speaking");
        if (VOICE_PROVIDER !== "cascade") pauseListening();

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
        const assembler = new SentenceAssembler();
        assembler.onSentence = (mimeType, base64) => {
          void player.enqueue(mimeType, base64).catch(() => {
            // Undecodable audio must not break the interview.
          });
        };
        assemblerRef.current = assembler;
      }

      if (!isSpeechRecognitionSupported()) {
        setVoiceNotice(
          "Voice input is not available in this browser. Use Chrome or Edge to speak; you can still read the conversation here.",
        );
        return;
      }

      // Endpointing: the recognizer emits a "final" after ~1s of silence, but
      // candidates pause mid-thought. Fragments are staged and only published
      // after TRANSCRIPT_HOLD_MS of no further speech; each new fragment
      // extends the staged text, so a thought split across pauses is sent as
      // one turn instead of several half-sentences to the LLM.
      const publishStagedTranscript = () => {
        holdTimerRef.current = null;
        const staged = stagedTranscriptRef.current;
        stagedTranscriptRef.current = null;
        if (!staged) return;
        setTranscript((entries) => [...entries, { role: "candidate", text: staged }]);
        if (!agentPresentRef.current) return;
        void room.localParticipant
          .publishData(encodeDataMessage({ type: "candidate-transcript", text: staged }), {
            reliable: true,
            destinationIdentities: [AI_AGENT_IDENTITY],
            topic: AGENT_DATA_TOPIC,
          })
          .catch(() => setVoiceNotice("Could not send your message. Please try again."));
      };

      recognitionRef.current = createSpeechRecognition({
        onFinalTranscript: (text) => {
          setInterimTranscript(null);
          stagedTranscriptRef.current = stagedTranscriptRef.current
            ? `${stagedTranscriptRef.current} ${text}`
            : text;
          if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
          // Barge-in (cascade): the candidate talked over the agent's voice —
          // stop the audio now; the answer still waits for the hold. The gate
          // is deliberately strict: short backchannels ("yes", "okay") and the
          // recognizer's pickup of the agent's voice must not cancel it.
          const staged = stagedTranscriptRef.current;
          if (
            VOICE_PROVIDER === "cascade" &&
            (speakingRef.current || audioPlayerRef.current?.isPlaying) &&
            isRealInterrupt(staged, agentReplyHistoryRef.current)
          ) {
            audioPlayerRef.current?.interrupt();
            assemblerRef.current?.reset();
            speakingRef.current = false;
            setAiState("processing");
          }
          holdTimerRef.current = setTimeout(publishStagedTranscript, TRANSCRIPT_HOLD_MS);
        },
        onInterimTranscript: (text) => {
          setInterimTranscript(text || null);
          // Speech resumed while a fragment is staged — keep holding.
          if (stagedTranscriptRef.current && holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = setTimeout(publishStagedTranscript, TRANSCRIPT_HOLD_MS);
          }
        },
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
/** Filler words that must never count as an interrupt on their own. */
const BACKCHANNEL_WORDS = new Set([
  "yes", "yeah", "yep", "ya", "no", "nope", "okay", "ok", "hmm", "hmmm", "mm",
  "um", "uh", "right", "sure", "alright", "fine", "great", "good", "nice",
  "thanks", "thank", "hello", "hi", "hey", "please", "continue", "go", "on",
  "so", "well", "like", "actually", "basically", "understood", "got",
]);

/** How long a final transcript waits for more speech before it is sent. */
const TRANSCRIPT_HOLD_MS = 3000;

function tokensOf(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

/**
 * Decides whether a final transcript that arrived while the agent was
 * speaking is a real barge-in. Guards against two false positives:
 * backchannel filler ("yes okay sure") and the recognizer transcribing the
 * agent's own TTS voice through the speakers (echo).
 */
function isRealInterrupt(text: string, agentReplies: string[]): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  // A real interrupt is a phrase, not a sound.
  if (words.length < 4 || text.trim().length < 12) return false;

  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (normalizedWords.length > 0 && normalizedWords.every((word) => BACKCHANNEL_WORDS.has(word))) {
    return false;
  }

  // Echo: the transcript largely repeats what the agent just said (it can be
  // a partial or imperfect transcription of the TTS output).
  const spoken = tokensOf(text);
  if (spoken.size === 0) return true;
  const agent = new Set<string>();
  for (const reply of agentReplies) {
    for (const word of tokensOf(reply)) agent.add(word);
  }
  let overlap = 0;
  for (const word of spoken) {
    if (agent.has(word)) overlap += 1;
  }
  if (overlap / spoken.size > 0.5) return false;

  const normalizedText = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  for (const reply of agentReplies) {
    const normalizedReply = ` ${reply.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
    if (normalizedReply.includes(normalizedText.trim())) return false;
  }
  return true;
}
