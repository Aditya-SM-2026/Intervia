"use client";

import { useEffect, useRef, useState } from "react";
import {
  DisconnectReason,
  ParticipantKind,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import {
  AlertTriangle,
  Check,
  Copy,
  Headphones,
  Loader2,
  LogOut,
  MessageSquareText,
  Mic,
  MicOff,
  PhoneOff,
  VolumeX,
} from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { CandidateVideo } from "./CandidateVideo";
import type { ConnectionStage } from "./ConnectionStatus";
import type { AiUiState } from "./AiStatus";
import { TranscriptPanel, type TranscriptEntry } from "./TranscriptPanel";
import { VoiceStage } from "./VoiceStage";

const TRANSCRIPTION_TOPIC = "lk.transcription";
/** Topic the HR page reports its microphone activity on. */
const HR_EVENT_TOPIC = "intervia.hr";
const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

const CANDIDATE_PREFIX = "candidate-";
const HR_PREFIX = "hr-";

// Minimal Web Speech API shapes: the DOM lib in this project doesn't ship them.
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type Stage = "joining" | "connected" | "ended" | "left" | "error";

interface HrRoomProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  durationMinutes: number;
  token: string;
}

interface HrCredentials {
  token: string;
  url: string;
  identity: string;
  /** Seconds left on the server's interview clock, when the interview has started. */
  remainingSeconds?: number;
  /** The server's current time, for correcting clock skew between the two. */
  serverNow?: string;
}

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

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The HR view: joins the same LiveKit room as the candidate, hears the whole
 * interview and can speak to the candidate. The agent never listens to HR: one
 * button hands HR the floor (their microphone opens and the agent pauses), and
 * pressing it again gives the interview back to the agent.
 */
export function HrRoom({ roomId, roomTitle, candidateName, durationMinutes, token }: HrRoomProps) {
  const [stage, setStage] = useState<Stage>("joining");
  const [failure, setFailure] = useState<string | null>(null);
  const [connectionStage, setConnectionStage] = useState<ConnectionStage>("connecting");
  const [started, setStart] = useState(false);
  const [muted, setMuted] = useState(true);
  const [hasFloor, setHasFloor] = useState(false);
  const [aiState, setAiState] = useState<AiUiState>("connecting");
  const [interviewerTrack, setInterviewerTrack] = useState<MediaStreamTrack | null>(null);
  const [candidateTrack, setCandidateTrack] = useState<MediaStreamTrack | null>(null);
  const [microphoneTrack, setMicrophoneTrack] = useState<MediaStreamTrack | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [showConversation, setShowConversation] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const publicationRef = useRef<LocalTrackPublication | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const leftIntentionallyRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const hasFloorRef = useRef(false);

  const agentMuted = hasFloor;

  useEffect(() => {
    if (stage !== "connected") return;
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      setElapsedSeconds(startedAt === null ? 0 : Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      recognitionRef.current?.stop();
      void roomRef.current?.disconnect();
      roomRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioElementsRef.current.forEach((element) => element.remove());
    };
  }, []);

  function send(type: string, data: Record<string, unknown> = {}) {
    const room = roomRef.current;
    if (!room || room.state !== "connected") return;
    void room.localParticipant
      .sendText(JSON.stringify({ type, ...data }), { topic: HR_EVENT_TOPIC })
      .catch(() => {});
  }

  function upsertTranscript(entry: TranscriptEntry & { id: string }) {
    setTranscript((current) => {
      const index = current.findIndex((item) => item.id === entry.id);
      if (index === -1) return [...current, entry];
      const next = [...current];
      next[index] = entry;
      return next;
    });
  }

  /** Local captions for what HR says, while they hold the floor. */
  function startRecognition() {
    if (recognitionRef.current) return;
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-IN";
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        // The browser hears the room even when the track is muted, so a caption
        // is only kept while HR actually has the floor.
        if (!hasFloorRef.current) return;
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result.isFinal) continue;
          const text = result[0]?.transcript?.trim();
          if (!text) continue;
          send("hr_turn", { text, at: new Date().toISOString() });
          const id = `hr-${Date.now()}-${index}`;
          upsertTranscript({ id, role: "hr", text });
        }
      };
      recognition.onend = () => {
        if (leftIntentionallyRef.current || !roomRef.current || !hasFloorRef.current) return;
        // Chrome stops recognition after a quiet spell; keep listening.
        try {
          recognition.start();
        } catch {
          // Already running.
        }
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Captions are a convenience; speaking and muting still work.
    }
  }

  function stopRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      // Already stopped.
    }
  }

  function wireRoom(room: Room) {
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.kind === ParticipantKind.AGENT) {
        setAiState(toAiState(participant.attributes[AGENT_STATE_ATTRIBUTE]));
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.kind === ParticipantKind.AGENT) setAiState("disconnected");
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (participant.isLocal || !(AGENT_STATE_ATTRIBUTE in changed)) return;
      const next = toAiState(changed[AGENT_STATE_ATTRIBUTE]);
      setAiState(next);
      // Same rule as the candidate page: the shared clock starts when the
      // interviewer first speaks (used only when the server had no start yet).
      if (next === "speaking" && startedAtRef.current === null) {
        startedAtRef.current = Date.now();
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.style.display = "none";
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
        if (participant.kind === ParticipantKind.AGENT) setInterviewerTrack(track.mediaStreamTrack);
      } else if (track.kind === Track.Kind.Video && participant.identity.startsWith(CANDIDATE_PREFIX)) {
        setCandidateTrack(track.mediaStreamTrack);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((element) => {
        element.remove();
        audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
      });
      if (track.kind === Track.Kind.Video) setCandidateTrack(null);
    });

    room.on(RoomEvent.Reconnecting, () => setConnectionStage("reconnecting"));
    room.on(RoomEvent.Reconnected, () => setConnectionStage("connected"));
    room.on(RoomEvent.Disconnected, (reason) => {
      roomRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (leftIntentionallyRef.current) return;
      if (reason === DisconnectReason.ROOM_DELETED) {
        setStage("ended");
        return;
      }
      setFailure("The connection to the interview was lost.");
      setStage("error");
    });

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participantInfo) => {
      const attributes = reader.info.attributes ?? {};
      const id = attributes["lk.segment_id"] || reader.info.id;
      const identity = participantInfo.identity;
      const role: TranscriptEntry["role"] = identity.startsWith(CANDIDATE_PREFIX)
        ? "candidate"
        : identity.startsWith(HR_PREFIX)
          ? "hr"
          : "interviewer";
      let text = "";
      try {
        for await (const chunk of reader) {
          text += chunk;
          if (text.trim()) upsertTranscript({ id, role, text: text.trim() });
        }
      } catch {
        // A dropped caption only affects the on-screen transcript.
      }
    });
  }

  useEffect(() => {
    if (!started) return;
    let cancelled = false;

    async function join() {
      try {
        const response = await fetch(`/api/interviews/${roomId}/hr/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const credentials = (await response.json()) as HrCredentials & {
          error?: { message?: string };
        };
        if (!response.ok || !credentials.token) {
          setFailure(credentials.error?.message ?? "This HR link is not working.");
          setStage("error");
          return;
        }
        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        wireRoom(room);
        await room.connect(credentials.url, credentials.token);

        const audio = stream.getAudioTracks()[0];
        if (audio) {
          publicationRef.current = await room.localParticipant.publishTrack(audio, {
            source: Track.Source.Microphone,
          });
          // HR listens first; the floor button opens their microphone.
          await publicationRef.current?.mute().catch(() => {});
          setMicrophoneTrack(audio);
          setMuted(true);
        }

        await room.startAudio().catch(() => {});
        // Browsers may keep audio blocked until a gesture; the HR page has
        // controls they will click, so one click is enough to start playback.
        document.addEventListener("pointerdown", () => void room.startAudio().catch(() => {}), {
          once: true,
        });
        // Captions start only when HR takes the floor; a muted HR must never
        // write into the transcript.
        // The interview clock is the server's, not this browser's join time:
        // HR sees the same time left as the candidate, however late they join.
        if (typeof credentials.remainingSeconds === "number") {
          const serverNow = credentials.serverNow ? Date.parse(credentials.serverNow) : Date.now();
          const skew = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
          const elapsed = durationMinutes * 60 - credentials.remainingSeconds;
          startedAtRef.current = Date.now() - elapsed * 1000 - skew;
          setElapsedSeconds(Math.max(0, Math.floor(elapsed)));
        } else {
          startedAtRef.current = null;
          setElapsedSeconds(0);
        }
        send("hr_present");
        setStage("connected");
        setConnectionStage("connected");
      } catch (cause) {
        if (cancelled) return;
        setFailure(
          cause instanceof Error && cause.message
            ? `Could not join the interview: ${cause.message}`
            : "Could not join the interview. Check the microphone permission and try again.",
        );
        setStage("error");
      }
    }

    void join();
    return () => {
      cancelled = true;
    };
    // The join runs once per click; the link is fixed for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  /**
   * One button, two jobs. Off: HR is muted and the agent runs the interview.
   * On: HR's microphone opens and the agent pauses. Pressing it again hands
   * the interview straight back to the agent.
   */
  async function handleToggleFloor() {
    const publication = publicationRef.current;
    if (!publication) return;
    if (!hasFloor) {
      await publication.unmute().catch(() => {});
      setMuted(false);
      setHasFloor(true);
      hasFloorRef.current = true;
      send("hr_speaking_start");
      startRecognition();
    } else {
      hasFloorRef.current = false;
      stopRecognition();
      send("hr_unmute");
      setHasFloor(false);
      setMuted(true);
      await publication.mute().catch(() => {});
    }
  }

  async function handleLeave() {
    leftIntentionallyRef.current = true;
    if (hasFloor) send("hr_unmute");
    recognitionRef.current?.stop();
    await roomRef.current?.disconnect();
    roomRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setStage("left");
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing to do: the address bar still has it.
    }
  }

  if (!started) {
    return (
      <main className="interview-stage grid min-h-dvh place-items-center bg-[#08123a] px-6 text-white">
        <div className="w-full max-w-md text-center">
          <BrandMark href={null} size="md" onDark />
          <h1 className="mt-6 text-2xl font-semibold">Join as HR</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            You are joining {candidateName ? `${candidateName}'s` : "the candidate's"} interview
            {roomTitle ? ` for ${roomTitle}` : ""}. You can listen to the whole call, and speak to
            the candidate whenever they need help.
          </p>
          <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm text-white/60">
            <li className="flex gap-2">
              <Headphones className="mt-0.5 size-4 shrink-0" aria-hidden />
              You hear the AI interviewer and the candidate.
            </li>
            <li className="flex gap-2">
              <Mic className="mt-0.5 size-4 shrink-0" aria-hidden />
              Press <span className="font-semibold text-white/80">Speak</span> to talk to the
              candidate: the AI pauses while your microphone is open. Press it again to hand the
              interview back.
            </li>
            <li className="flex gap-2">
              <MicOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              The AI never listens to you: it only hears the candidate.
            </li>
          </ul>
          <button
            type="button"
            onClick={() => setStart(true)}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#08123a] transition hover:bg-white/90"
          >
            <Mic className="size-4" aria-hidden />
            Join the interview
          </button>
          <p className="mt-3 text-xs text-white/45">
            Your microphone is used so you can speak, and your voice is part of the recording.
          </p>
        </div>
      </main>
    );
  }

  if (stage === "joining") {
    return (
      <main className="interview-stage grid min-h-dvh place-items-center bg-[#08123a] px-6 text-white">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
          <p className="text-sm text-white/70">Joining the interview as HR…</p>
        </div>
      </main>
    );
  }

  if (stage === "error") {
    return (
      <main className="interview-stage grid min-h-dvh place-items-center bg-[#08123a] px-6 text-white">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-amber-400/15 text-amber-300">
            <AlertTriangle className="size-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold">Let&apos;s get you back in</h1>
          <p role="alert" className="mt-2 text-sm text-white/70">
            {failure ?? "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={handleCopyLink}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#08123a]"
          >
            <Copy className="size-4" aria-hidden />
            Copy this link
          </button>
          <p className="mt-2 text-xs text-white/50">Reload the page to try again.</p>
        </div>
      </main>
    );
  }

  if (stage === "ended") {
    return (
      <main className="interview-stage grid min-h-dvh place-items-center bg-[#08123a] px-6 text-white">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-white/10">
            <Check className="size-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold">The interview has ended</h1>
          <p className="mt-2 text-sm text-white/70">
            It finished at the scheduled time for the candidate and for you. You can close this page.
          </p>
        </div>
      </main>
    );
  }

  if (stage === "left") {
    return (
      <main className="interview-stage grid min-h-dvh place-items-center bg-[#08123a] px-6 text-white">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-white/10">
            <LogOut className="size-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold">You left the interview</h1>
          <p className="mt-2 text-sm text-white/70">
            The candidate and the AI interviewer carried on without you.
          </p>
        </div>
      </main>
    );
  }

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
          <h1 className="hidden truncate text-sm text-white/70 sm:block">
            {roomTitle} · HR view
          </h1>
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
          <span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs tabular-nums text-white/90">
            {formatClock(Math.max(0, durationMinutes * 60 - elapsedSeconds))} left
          </span>
        </div>
      </header>

      {agentMuted && (
        <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 sm:mx-8">
          <span className="flex items-center gap-2">
            <VolumeX className="size-4 shrink-0" aria-hidden />
            The agent is paused while you have the floor. Press the button again when you are done.
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 px-5 pb-28 sm:px-8">
          <span
            className={`grid size-20 place-items-center rounded-full bg-gradient-to-br from-[#6d8dff] to-[#2446d8] ${
              agentMuted ? "opacity-50" : ""
            } ${aiState === "speaking" ? "motion-safe:animate-pulse shadow-[0_0_90px_rgba(122,167,255,0.7)]" : "shadow-[0_0_60px_rgba(111,211,168,0.35)]"}`}
            aria-hidden="true"
          >
            <Mic className="size-8 text-white" />
          </span>

          <VoiceStage
            state={agentMuted ? "listening" : aiState}
            detail={agentMuted ? "The agent is paused while you help the candidate." : null}
            interviewerTrack={interviewerTrack}
            microphoneTrack={microphoneTrack}
            muted={muted}
          />

          <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/70">
            <Headphones className="size-3.5" aria-hidden />
            Listening to the AI interviewer and the candidate
          </p>
        </section>

        {showConversation && (
          <aside className="absolute inset-x-3 bottom-24 top-20 z-20 flex flex-col rounded-2xl border border-white/10 bg-[#0d1838]/95 p-4 backdrop-blur sm:inset-x-auto sm:right-5 sm:w-[22rem] lg:static lg:mb-24 lg:mr-5 lg:mt-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Conversation so far</h2>
              <button
                type="button"
                onClick={() => setShowConversation(false)}
                aria-label="Hide the conversation"
                className="rounded-lg px-2 py-1 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                Hide
              </button>
            </div>
            <TranscriptPanel
              entries={transcript}
              labels={{ candidate: candidateName || "Candidate", interviewer: "Interviewer", hr: "You (HR)" }}
              interim={null}
            />
          </aside>
        )}
      </div>

      {candidateTrack && (
        <div className="absolute bottom-24 left-4 w-32 sm:bottom-5 sm:left-6 sm:w-48">
          <CandidateVideo track={candidateTrack} label={candidateName || "Candidate"} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-5 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0d1838]/80 p-2 backdrop-blur">
          <button
            type="button"
            onClick={handleToggleFloor}
            aria-pressed={hasFloor}
            aria-label={hasFloor ? "Let the agent continue" : "Speak to the candidate"}
            className={`inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
              hasFloor
                ? "bg-amber-400 text-[#08123a] hover:bg-amber-300"
                : "bg-white text-[#0b1640] hover:bg-white/90"
            }`}
          >
            {hasFloor ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
            {hasFloor ? "Let agent continue" : "Speak"}
          </button>
          <button
            type="button"
            onClick={() => setShowConversation((shown) => !shown)}
            aria-label="Show the conversation"
            className={`inline-flex h-12 min-w-12 items-center justify-center rounded-full transition ${
              showConversation ? "bg-[#7aa7ff]/25 text-white ring-1 ring-[#7aa7ff]/60" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            <MessageSquareText className="size-5" aria-hidden />
          </button>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
          <button
            type="button"
            onClick={handleLeave}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-500"
          >
            <PhoneOff className="size-5" aria-hidden />
            Leave
          </button>
        </div>
      </div>

      {copied && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#08123a]">
          <Check className="mr-1 inline size-3" aria-hidden />
          Link copied
        </p>
      )}
    </main>
  );
}
