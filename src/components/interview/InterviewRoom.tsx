"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  exitFullscreen,
  isFullscreen,
  isFullscreenSupported,
  onFullscreenChange,
  requestFullscreen,
} from "@/lib/browser/fullscreen";
import { startCandidateRecorder, type CandidateRecorder } from "@/lib/recordings/candidate-recorder";
import type { ConnectionStage } from "./ConnectionStatus";
import type { AiUiState } from "./AiStatus";
import type { TranscriptEntry } from "./TranscriptPanel";
import { CandidateMessage } from "./CandidateShell";
import { CandidateEndScreen, ConnectingOrb, JoinScreen } from "./CandidateScreens";
import { LiveRoom, type PauseReason } from "./LiveRoom";

interface InterviewRoomProps {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  recruiterName: string | null;
  durationMinutes: number;
}

type Stage = "prejoin" | "connecting" | "connected" | "ended" | "left" | "error";

interface Pause {
  reason: PauseReason;
  /** When the candidate must be back, in epoch milliseconds. */
  deadline: number;
  secondsLeft: number;
  totalSeconds: number;
}

/** Text-stream topics: live captions from the agent, browser events to it. */
const TRANSCRIPTION_TOPIC = "lk.transcription";
const CLIENT_EVENT_TOPIC = "intervia.client";
/** Participant attribute the agent framework publishes its state on. */
const AGENT_STATE_ATTRIBUTE = "lk.agent.state";
/** If no interviewer has joined after this long, say so instead of waiting silently. */
const AGENT_JOIN_TIMEOUT_MS = 30_000;
/** How long a candidate who left the interview may take to come back. */
const PAUSE_WINDOW_SECONDS = 30;

/**
 * The pause window, in seconds. Local development can shorten it with
 * `?pauseWindow=15` so the full wait is not needed for every test; the
 * production build always uses the real window.
 */
function pauseWindowSeconds(): number {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const override = Number(new URLSearchParams(window.location.search).get("pauseWindow"));
    if (Number.isFinite(override) && override >= 5 && override <= PAUSE_WINDOW_SECONDS) return override;
  }
  return PAUSE_WINDOW_SECONDS;
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
  /** Set while the interview is paused because the candidate left it. */
  const [pause, setPause] = useState<Pause | null>(null);

  const roomRef = useRef<Room | null>(null);
  const credentialsRef = useRef<LiveKitJoinCredentials | null>(null);
  const pauseRef = useRef<Pause | null>(null);
  /**
   * The pause budget for the whole interview: 30 seconds away in total, not
   * 30 seconds every time. Coming back stops the clock but spends what was
   * used; leaving again continues from there.
   */
  const pauseBudgetRef = useRef({ totalSeconds: PAUSE_WINDOW_SECONDS, usedSeconds: 0 });
  const pauseStartedAtRef = useRef<number | null>(null);
  /** The microphone was on when the pause started, so it goes back on. */
  const micWasOnRef = useRef(false);
  /** Full screen was really granted at least once: only then can leaving it mean anything. */
  const fullscreenArmedRef = useRef(false);
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
    pauseRef.current = null;
    pauseStartedAtRef.current = null;
    setPause(null);
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

  /** Tells the interviewer's agent what the page is doing, if it is there. */
  function sendClientEvent(type: string) {
    const room = roomRef.current;
    if (!room || room.state !== "connected") return;
    void room.localParticipant
      .sendText(JSON.stringify({ type }), { topic: CLIENT_EVENT_TOPIC })
      .catch(() => {});
  }

  /**
   * Records the pause on the server, which owns the pause budget and the
   * timeline the recruiter reads afterwards. The recording token proves this
   * is the participant who joined, so nobody else can move an interview's
   * state.
   */
  const postPresence = useCallback(
    (state: "paused" | "resumed" | "expired" | "left", reason: PauseReason | "left") => {
      const credentials = credentialsRef.current;
      if (!credentials?.recordingToken) return Promise.resolve();
      return fetch(`/api/interviews/${encodeURIComponent(roomId)}/presence`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-recording-id": credentials.identity,
          "x-recording-token": credentials.recordingToken,
        },
        body: JSON.stringify({ state, reason }),
        keepalive: true,
      })
        .then(() => undefined)
        .catch(() => undefined);
    },
    [roomId],
  );

  /** The budget is spent: the interview ends here and is sent as it stands. */
  const endForPause = useCallback(
    (reason: PauseReason) => {
      pauseRef.current = null;
      pauseStartedAtRef.current = null;
      setPause(null);
      postPresence("expired", reason);

      leftIntentionallyRef.current = true;
      const room = roomRef.current;
      roomRef.current = null;
      void room?.disconnect().catch(() => {});
      releaseMedia();
      setStage("ended");
    },
    [postPresence],
  );

  /**
   * Pauses the interview: the interviewer can no longer hear or answer, the
   * candidate's own microphone stops sending, and a countdown takes over the
   * screen. Leaving full screen or hiding the tab leads here, because both
   * mean the candidate is no longer in the interview. The countdown is what is
   * left of one budget for the whole interview, so leaving twice does not
   * buy another 30 seconds.
   */
  const beginPause = useCallback(
    (reason: PauseReason) => {
      if (pauseRef.current) return;
      const budget = pauseBudgetRef.current;
      const secondsLeft = Math.max(0, budget.totalSeconds - budget.usedSeconds);
      if (secondsLeft < 1) {
        // Nothing left to spend: they are out of time away, so it ends now.
        endForPause(reason);
        return;
      }

      const now = Date.now();
      pauseStartedAtRef.current = now;
      const next: Pause = {
        reason,
        deadline: now + secondsLeft * 1000,
        secondsLeft: Math.ceil(secondsLeft),
        totalSeconds: Math.ceil(secondsLeft),
      };
      pauseRef.current = next;
      setPause(next);

      // Whatever the candidate is saying stops reaching the interviewer.
      const publication = publicationsRef.current.audio;
      micWasOnRef.current = Boolean(publication && !publication.isMuted);
      if (micWasOnRef.current) void publication?.mute().catch(() => {});
      setMuted(true);
      // And the interviewer's voice does not play into an empty room.
      audioElementsRef.current.forEach((element) => {
        if (element instanceof HTMLMediaElement) element.pause();
      });

      sendClientEvent("interview_paused");
      postPresence("paused", reason);
    },
    [endForPause, postPresence],
  );

  /** Back from a pause: full screen again, microphone again, same question. */
  const resumeInterview = useCallback(() => {
    const current = pauseRef.current;
    if (!current) return;
    // First, before anything else: the click is the permission the browser
    // needs to give the screen back.
    if (isFullscreenSupported()) void requestFullscreen();

    const startedAt = pauseStartedAtRef.current;
    if (startedAt !== null) {
      const budget = pauseBudgetRef.current;
      budget.usedSeconds = Math.min(
        budget.totalSeconds,
        budget.usedSeconds + (Date.now() - startedAt) / 1000,
      );
    }
    pauseStartedAtRef.current = null;
    pauseRef.current = null;
    setPause(null);

    const publication = publicationsRef.current.audio;
    if (micWasOnRef.current && publication) void publication.unmute().catch(() => {});
    setMuted(!micWasOnRef.current);
    audioElementsRef.current.forEach((element) => {
      if (element instanceof HTMLMediaElement) void element.play().catch(() => {});
    });

    sendClientEvent("interview_resumed");
    postPresence("resumed", current.reason);
  }, [postPresence]);

  /** The countdown reached zero while the candidate was still away. */
  const expirePause = useCallback(() => {
    const current = pauseRef.current;
    if (!current) return;
    endForPause(current.reason);
  }, [endForPause]);

  /**
   * Leave is not a pause: this is the candidate choosing to end the
   * interview. It stops immediately and the report says they exited.
   */
  const leaveInterview = useCallback(() => {
    pauseRef.current = null;
    pauseStartedAtRef.current = null;
    setPause(null);

    leftIntentionallyRef.current = true;
    sendClientEvent("interview_left");
    void postPresence("left", "left");

    const room = roomRef.current;
    roomRef.current = null;
    // Give the agent and the server a moment to hear about it before the
    // connection goes.
    window.setTimeout(() => {
      void room?.disconnect().catch(() => {});
    }, 200);
    releaseMedia();
    setStage("left");
  }, [postPresence]);

  // Cleanup when the page is closed or navigated away from.
  useEffect(() => {
    return () => {
      leftIntentionallyRef.current = true;
      void roomRef.current?.disconnect();
      roomRef.current = null;
      releaseMedia();
    };
  }, []);

  // The interview runs on the whole screen once the candidate allows it; the
  // moment it stops being on screen (left, ended, or failed) they get their
  // browser back. No cleanup function: React runs effect cleanups twice in
  // development, and the second run would exit the fullscreen just opened.
  useEffect(() => {
    if (stage === "prejoin" || stage === "connecting" || stage === "connected") return;
    void exitFullscreen();
  }, [stage]);

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
    const onVisibility = () => sendClientEvent(document.hidden ? "tab_hidden" : "tab_visible");
    const onBlur = () => sendClientEvent("window_blur");
    const onFocus = () => sendClientEvent("window_focus");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [stage]);

  // Leaving the full screen pauses the interview. The page is never told that
  // Escape was pressed, but it is told that full screen ended, whichever way
  // it happened. Nothing is paused until full screen has really been granted
  // once, so a browser that refuses it does not leave the candidate stuck.
  useEffect(() => {
    if (stage !== "connected") {
      fullscreenArmedRef.current = false;
      return;
    }
    if (isFullscreen()) fullscreenArmedRef.current = true;
    return onFullscreenChange(() => {
      if (isFullscreen()) {
        fullscreenArmedRef.current = true;
        return;
      }
      if (fullscreenArmedRef.current) beginPause("fullscreen");
    });
  }, [stage, beginPause]);

  // Switching tab, switching app, or locking the phone is leaving too: the
  // interview stops while they are away rather than talking to nobody.
  useEffect(() => {
    if (stage !== "connected") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") beginPause("tab_hidden");
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stage, beginPause]);

  // The countdown is computed from a fixed deadline, never from a count of
  // ticks: a background tab or a sleeping phone cannot stretch the two
  // minutes, and coming back after them ends the interview at once.
  useEffect(() => {
    if (!pause) return;
    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((pause.deadline - Date.now()) / 1000));
      if (secondsLeft <= 0) {
        expirePause();
        return;
      }
      setPause((current) =>
        current && current.secondsLeft !== secondsLeft ? { ...current, secondsLeft } : current,
      );
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [pause?.deadline, expirePause]); // eslint-disable-line react-hooks/exhaustive-deps

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
        "The connection to the interview was lost. Rejoin within 2 minutes and the interview continues exactly where it stopped: same question, same transcript, same clock.",
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
    credentialsRef.current = credentials;
    streamRef.current = stream;
    setStage("connecting");
    setConnectionStage("connecting");
    setTranscript([]);
    setMuted(false);
    setCameraOff(false);
    pauseRef.current = null;
    pauseStartedAtRef.current = null;
    setPause(null);
    // The pause budget is for the whole interview: a candidate who reloads
    // keeps the time they had left, never a fresh 30 seconds.
    const serverBudget = credentials.pauseBudgetSeconds;
    const serverLeft = credentials.pauseSecondsLeft;
    const alreadyUsed =
      serverBudget !== undefined && serverLeft !== undefined
        ? Math.max(0, serverBudget - serverLeft)
        : 0;
    const totalSeconds = pauseWindowSeconds();
    pauseBudgetRef.current = {
      totalSeconds,
      usedSeconds: Math.min(alreadyUsed, totalSeconds),
    };
    fullscreenArmedRef.current = isFullscreen();

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
    // The red button is the candidate's way out: it ends the interview now
    // rather than pausing it, and the report records that they exited.
    leaveInterview();
  }

  function handleRetry() {
    leftIntentionallyRef.current = false;
    credentialsRef.current = null;
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
        pause={
          pause
            ? {
                reason: pause.reason,
                secondsLeft: pause.secondsLeft,
                totalSeconds: pause.totalSeconds,
              }
            : null
        }
        onResume={resumeInterview}
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
