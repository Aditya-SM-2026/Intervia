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
} from "livekit-client";
import type { LiveKitJoinCredentials } from "@/lib/livekit/client";
import { startCandidateRecorder, type CandidateRecorder } from "@/lib/recordings/candidate-recorder";
import type { ConnectionStage } from "./ConnectionStatus";
import type { AiUiState } from "./AiStatus";
import type { TranscriptEntry } from "./TranscriptPanel";
import { CandidateMessage } from "./CandidateShell";
import { CandidateEndScreen, ConnectingOrb, JoinScreen } from "./CandidateScreens";
import { LiveRoom } from "./LiveRoom";

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
  const [hrNotice, setHrNotice] = useState(false);
  /** HR is in the call (they are shown as a second camera tile). */
  const [hrPresent, setHrPresent] = useState(false);
  const [hrTrack, setHrTrack] = useState<MediaStreamTrack | null>(null);

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
  const hrNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (hrNoticeTimerRef.current) clearTimeout(hrNoticeTimerRef.current);
    hrNoticeTimerRef.current = null;
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

  function announceHr() {
    setHrNotice(true);
    if (hrNoticeTimerRef.current) clearTimeout(hrNoticeTimerRef.current);
    hrNoticeTimerRef.current = setTimeout(() => setHrNotice(false), 5000);
    // A soft two-note chime, quiet enough not to break the conversation.
    try {
      const context = new AudioContext();
      const start = context.currentTime;
      [660, 880].forEach((frequency, index) => {
        const at = start + index * 0.16;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.05, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.18);
      });
      setTimeout(() => void context.close().catch(() => {}), 900);
    } catch {
      // Sound is optional; the notice still shows.
    }
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
      // HR joining is quiet: a small notice and a chime, never a pause.
      else if (participant.identity.startsWith("hr-")) {
        setHrPresent(true);
        announceHr();
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (isAgent(participant)) setAiState("disconnected");
      if (participant.identity.startsWith("hr-")) {
        setHrPresent(false);
        setHrTrack(null);
      }
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (participant.isLocal || !(AGENT_STATE_ATTRIBUTE in changed)) return;
      const next = toAiState(changed[AGENT_STATE_ATTRIBUTE]);
      setAiState(next);
      if (next === "speaking") setStartedAtMs((current) => current ?? Date.now());
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
      if (track.kind === Track.Kind.Video && participant.identity.startsWith("hr-")) {
        setHrTrack(track.mediaStreamTrack);
        return;
      }
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.style.display = "none";
      document.body.appendChild(element);
      audioElementsRef.current.push(element);
      setInterviewerTrack(track.mediaStreamTrack);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant) => {
      if (track.kind === Track.Kind.Video && participant.identity.startsWith("hr-")) {
        setHrTrack(null);
      }
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
      setFailure(
        "The connection to the interview was lost. Rejoin within 5 minutes and the interview continues exactly where it stopped: same question, same transcript, same clock.",
      );
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
    setMuted(false);
    setCameraOff(false);

    // Resuming an interview in progress: the server owns the clock, so the
    // timer continues from the original start rather than restarting. On a
    // first join this is absent and the clock starts when the agent speaks.
    const resumeRemaining = credentials.remainingSeconds;
    if (resumeRemaining !== undefined) {
      const resumeStartMs = Date.now() - (durationMinutes * 60 - resumeRemaining) * 1000;
      setStartedAtMs(resumeStartMs);
      setElapsedSeconds(Math.floor((Date.now() - resumeStartMs) / 1000));
    } else {
      setStartedAtMs(null);
      setElapsedSeconds(0);
    }

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
      // HR may already be waiting in the room before the candidate arrives.
      if ([...room.remoteParticipants.values()].some((participant) => participant.identity.startsWith("hr-"))) {
        setHrPresent(true);
        announceHr();
      }

      setConnectionStage("connected");
      setStage("connected");

      // Server-authoritative hard stop: on a resume, only the remaining time
      // (plus grace for a goodbye) is scheduled, never the full duration.
      const stopAfterMs =
        (resumeRemaining !== undefined
          ? Math.max(0, resumeRemaining) * 1000
          : durationMinutes * 60_000) +
        30_000;
      hardStopTimerRef.current = setTimeout(() => {
        hardStopTimerRef.current = null;
        const live = roomRef.current;
        if (!live) return;
        leftIntentionallyRef.current = true;
        roomRef.current = null;
        void live.disconnect().catch(() => {});
        releaseMedia();
        setStage("ended");
      }, stopAfterMs);
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
      <JoinScreen
        roomId={roomId}
        roomTitle={roomTitle}
        candidateName={candidateName}
        recruiterName={recruiterName}
        durationMinutes={durationMinutes}
        onVerified={setCredentials}
        onProceed={handleProceed}
      />
    );
  }

  if (stage === "connecting") {
    return (
      <CandidateMessage icon={<ConnectingOrb />} title="Connecting you to your interviewer">
        <p>This takes a few seconds. Keep this tab open.</p>
      </CandidateMessage>
    );
  }

  if (stage === "connected") {
    return (
      <LiveRoom
        roomTitle={roomTitle}
        candidateName={candidateName}
        durationMinutes={durationMinutes}
        elapsedSeconds={elapsedSeconds}
        connectionStage={connectionStage}
        aiState={aiState}
        aiDetail={aiDetail}
        interviewerTrack={interviewerTrack}
        microphoneTrack={microphoneTrack}
        videoTrack={videoTrack}
        muted={muted}
        cameraOff={cameraOff}
        transcript={transcript}
        showConversation={showConversation}
        hrNotice={hrNotice}
        hrPresent={hrPresent}
        hrTrack={hrTrack}
        audioBlocked={audioBlocked}
        onToggleConversation={() => setShowConversation((shown) => !shown)}
        onToggleMute={handleToggleMute}
        onToggleCamera={handleToggleCamera}
        onLeave={handleLeave}
        onEnableAudio={() => {
          void roomRef.current?.startAudio().then(() => setAudioBlocked(false));
        }}
      />
    );
  }

  return (
    <CandidateEndScreen
      kind={stage}
      candidateName={candidateName}
      recruiterName={recruiterName}
      failure={failure}
      onRetry={handleRetry}
    />
  );
}
