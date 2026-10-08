import "server-only";
import { Room, RoomEvent, type RemoteParticipant } from "@livekit/rtc-node";
import { createLlmProvider } from "@/lib/ai/llm-provider";
import { LlmError } from "@/lib/ai/llm-error";
import type { AiMessage } from "@/lib/ai/ai.types";
import {
  AI_AGENT_IDENTITY,
  AGENT_DATA_TOPIC,
  decodeCandidateDataMessage,
  encodeDataMessage,
  type AgentDataMessage,
} from "@/lib/ai/agent-protocol";
import { generateLiveKitToken } from "@/lib/livekit/token";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { getInterviewRepository } from "@/server/repositories";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import { CloudTtsEngine } from "./tts";
import { AI_AUDIO_MAX_CHUNK_BYTES } from "@/lib/ai/agent-protocol";

/**
 * One AI agent participant in one interview room. It joins the LiveKit room,
 * listens for candidate transcripts on the data channel, generates replies
 * through the LLM provider, and broadcasts its messages and status back.
 *
 * The brain is assembled from the session record (job description, resume,
 * role) and follows an integrity policy: dynamic follow-ups, reworded
 * revisits of suspicious answers, and never revealing answers or scores.
 * Every spoken turn is persisted incrementally to the session transcript.
 */

const GREETING_DELAY_MS = 1500;
const EMPTY_ROOM_SHUTDOWN_MS = 10_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_JD_PROMPT_CHARS = 6_000;
const MAX_RESUME_PROMPT_CHARS = 4_000;

const BASE_PERSONA_PROMPT = [
  "You are a professional AI interviewer conducting a live spoken interview.",
  "Keep replies short (2-3 sentences), conversational and warm, because they are spoken aloud.",
  "Ask one natural follow-up question at a time.",
  "Never use markdown, lists or emojis; plain spoken sentences only.",
].join(" ");

const INTERVIEW_CONDUCT_PROMPT = [
  "Conduct the interview according to these rules:",
  "- Build a mental plan from the job description and the candidate's resume, and cover its main areas across the interview.",
  "- Ask follow-up questions dynamically based on what the candidate actually said; do not walk a fixed list.",
  "- Mix role-specific technical questions with common-sense and preference questions.",
  "- If an answer sounds scripted, evasive, or inconsistent, politely revisit it later, reworded, to check it holds up.",
  "- When an answer is thin, ask the candidate to go deeper or give a concrete example.",
  "- Never give the candidate answers, hints, feedback on correctness, or any score.",
  "- If the candidate asks what you think of them or asks for the answer, steer back to the interview.",
  "- Keep the tone professional and neutral even under pressure.",
].join(" ");

const FALLBACK_GREETING =
  "Hello, and thank you for joining. Please tell me a little about yourself.";

const CANDIDATE_IDENTITY_PREFIX = "candidate-";

/** Assembles the interviewer system prompt from the session record. */
function buildSystemPrompt(room: InterviewRoom | null): string {
  if (!room) return BASE_PERSONA_PROMPT;

  const sections: string[] = [BASE_PERSONA_PROMPT, INTERVIEW_CONDUCT_PROMPT];

  const details = [
    room.roleTitle ? `Role: ${room.roleTitle}` : null,
    room.candidateName ? `Candidate: ${room.candidateName}` : null,
    room.recruiterName ? `Recruiter: ${room.recruiterName}` : null,
  ].filter(Boolean);
  if (details.length > 0) sections.push(details.join("\n"));

  if (room.jobDescription) {
    sections.push(
      `Job description:\n${room.jobDescription.text.slice(0, MAX_JD_PROMPT_CHARS)}`,
    );
  }

  if (room.resume) {
    if (room.resume.unreadable) {
      sections.push(
        "The candidate's resume could not be read. Do not mention the resume; explore their experience through questions alone.",
      );
    } else {
      sections.push(
        `Candidate resume (${room.resume.fileName}):\n${room.resume.text.slice(0, MAX_RESUME_PROMPT_CHARS)}`,
      );
    }
  }

  return sections.join("\n\n");
}
  
export class InterviewAgentSession {
  /** Called once the session has stopped for any reason. */
  onEnded: (() => void) | null = null;

  private readonly room = new Room();
  private readonly llm = createLlmProvider();
  /**
   * Cascade pipeline: with AGENT_TTS_PROVIDER=cloud the worker speaks replies
   * through Cloud TTS and streams the audio to the page; otherwise the page
   * speaks the text itself (browser speechSynthesis).
   */
  private readonly tts = new CloudTtsEngine(
    process.env.AGENT_TTS_PROVIDER?.trim().toLowerCase() === "cloud",
  );
  private nextReplyId = 0;
  private history: AiMessage[] = [];
  private isProcessing = false;
  private stopping = false;
  private greetingTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyRoomTimer: ReturnType<typeof setTimeout> | null = null;
  private systemPrompt = BASE_PERSONA_PROMPT;
  /** When the last interviewer question was sent (for answer latency). */
  private lastQuestionAskedAt: string | null = null;

  constructor(readonly roomId: string) {}

  async start(): Promise<void> {
    const credentials = await generateLiveKitToken({
      roomName: getLiveKitRoomName(this.roomId),
      identity: AI_AGENT_IDENTITY,
      displayName: "Intervia AI",
      agent: true,
    });

    this.room.on(RoomEvent.DataReceived, this.onDataReceived);
    this.room.on(RoomEvent.ParticipantConnected, this.onParticipantsChanged);
    this.room.on(RoomEvent.ParticipantDisconnected, this.onParticipantsChanged);
    this.room.on(RoomEvent.ConnectionStateChanged, this.onConnectionStateChanged);
    this.room.on(RoomEvent.Disconnected, this.onRoomDisconnected);

    await this.room.connect(credentials.url, credentials.token, { autoSubscribe: true, dynacast: false });
    console.log(
      `[agent] joined room for interview ${this.roomId} (provider: ${this.llm.name}, tts: ${this.tts.enabled ? "cloud" : "off"}, candidates: ${this.candidateParticipants().length})`,
    );

    await this.loadSessionContext();

    if (this.candidateParticipants().length > 0) {
      this.scheduleGreeting();
    } else {
      this.scheduleEmptyRoomShutdown();
    }
  }

  /**
   * Loads the session record (job description, resume, role) and assembles
   * the brain from it. A missing or failed load keeps the generic prompt so
   * the interview can still run.
   */
  private async loadSessionContext(): Promise<void> {
    try {
      const room = await getInterviewRepository().get(this.roomId);
      this.systemPrompt = buildSystemPrompt(room);
      const parts = [
        room?.jobDescription ? "jd" : null,
        room?.resume ? (room.resume.unreadable ? "resume(unreadable)" : "resume") : null,
      ].filter(Boolean);
      console.log(
        `[agent] session context for ${this.roomId}: ${parts.length > 0 ? parts.join(", ") : "none (generic prompt)"}`,
      );
    } catch (error) {
      console.error(`[agent] failed to load session context: ${describeError(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.greetingTimer) clearTimeout(this.greetingTimer);
    if (this.emptyRoomTimer) clearTimeout(this.emptyRoomTimer);
    await this.room.disconnect().catch(() => {});
    this.onEnded?.();
  }

  private onDataReceived = (payload: Uint8Array, participant?: RemoteParticipant) => {
    // Only transcripts from human candidates are accepted. The agent never
    // listens to itself, so it cannot react to its own output.
    const identity = participant?.info?.identity ?? "";
    if (!identity.startsWith(CANDIDATE_IDENTITY_PREFIX)) return;

    const message = decodeCandidateDataMessage(payload);
    if (message) {
      void this.handleTranscript(message.text);
    }
  };

  private onParticipantsChanged = () => {
    if (this.stopping) return;
    if (this.candidateParticipants().length > 0) {
      if (this.emptyRoomTimer) {
        clearTimeout(this.emptyRoomTimer);
        this.emptyRoomTimer = null;
      }
    } else {
      this.scheduleEmptyRoomShutdown();
    }
  };

  private onConnectionStateChanged = (state: unknown, reason?: unknown): void => {
    if (state === "connected" || state === "connecting") return;
    console.log(
      `[agent] connection state in interview ${this.roomId}: ${String(state)}${reason ? ` (${String(reason)})` : ""}`,
    );
  };

  private onRoomDisconnected = (reason?: unknown): void => {
    console.log(
      `[agent] room disconnected in interview ${this.roomId}${reason ? ` (reason: ${String(reason)})` : ""}`,
    );
    void this.stop();
  };

  private scheduleGreeting(): void {
    if (this.greetingTimer) clearTimeout(this.greetingTimer);
    this.greetingTimer = setTimeout(() => {
      this.greetingTimer = null;
      void this.sendGreeting();
    }, GREETING_DELAY_MS);
  }

  private scheduleEmptyRoomShutdown(): void {
    if (this.emptyRoomTimer || this.stopping) return;
    this.emptyRoomTimer = setTimeout(() => {
      this.emptyRoomTimer = null;
      console.log(`[agent] no candidates left in interview ${this.roomId}, leaving`);
      void this.stop();
    }, EMPTY_ROOM_SHUTDOWN_MS);
  }

  private async sendGreeting(): Promise<void> {
    let text = FALLBACK_GREETING;
    try {
      const reply = await this.llm.generateReply([
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content:
            "The candidate has just joined the interview room. Greet them warmly in one or two sentences and invite them to introduce themselves.",
        },
      ]);
      text = reply.text;
    } catch (error) {
      // A failed greeting must not stop the interview; fall back to the canned one.
      console.error(`[agent] greeting LLM call failed: ${describeError(error)}`);
    }

    await this.speakReply(text);
    this.sendAgentMessage({ type: "ai-status", state: "listening" });
  }

  private async handleTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return; // empty speech
    if (this.isProcessing || this.stopping) return; // basic turn-taking

    this.isProcessing = true;
    this.sendAgentMessage({ type: "ai-status", state: "processing" });

    const answeredAt = new Date().toISOString();
    this.recordTurn({
      speaker: "candidate",
      text: trimmed,
      askedAt: this.lastQuestionAskedAt,
      answeredAt,
      latencyMs: this.lastQuestionAskedAt
        ? Date.parse(answeredAt) - Date.parse(this.lastQuestionAskedAt)
        : null,
    });
    this.lastQuestionAskedAt = null;

    try {
      this.history.push({ role: "user", content: trimmed });
      const reply = await this.llm.generateReply([
        { role: "system", content: this.systemPrompt },
        ...this.recentHistory(),
      ]);
      this.history.push({ role: "assistant", content: reply.text });
      this.history = this.history.slice(-MAX_HISTORY_MESSAGES);

      await this.speakReply(reply.text);
    } catch (error) {
      console.error(`[agent] reply failed in interview ${this.roomId}: ${describeError(error)}`);
      this.sendAgentMessage({
        type: "ai-status",
        state: "error",
        detail:
          error instanceof LlmError
            ? error.message
            : "The AI interviewer could not respond just now.",
      });
    } finally {
      this.isProcessing = false;
      if (!this.stopping) {
        this.sendAgentMessage({ type: "ai-status", state: "listening" });
      }
    }
  }

  /**
   * Sends the reply text (for the transcript) and, in cascade mode, speaks it:
   * each sentence is synthesized by Cloud TTS and streamed as audio chunks on
   * the data channel, terminated by ai-audio-end.
   */
  private async speakReply(text: string): Promise<void> {
    const askedAt = new Date().toISOString();
    this.lastQuestionAskedAt = askedAt;
    this.recordTurn({
      speaker: "interviewer",
      text,
      askedAt,
      answeredAt: null,
      latencyMs: null,
    });
    // spoken=true tells the page audio chunks will follow, so it must not
    // speak the text itself (two voices would overlap).
    this.sendAgentMessage({ type: "ai-message", text, spoken: this.tts.enabled });
    if (!this.tts.enabled) return;

    const replyId = ++this.nextReplyId;
    let seq = 0;
    try {
      for (const sentence of CloudTtsEngine.splitSentences(text)) {
        if (this.stopping) return;
        const audio = await this.tts.synthesizeSentence(sentence);
        for (const piece of splitBase64(audio.bytes.toString("base64"), AI_AUDIO_MAX_CHUNK_BYTES)) {
          this.sendAgentMessage({
            type: "ai-audio-chunk",
            replyId,
            seq: seq++,
            mimeType: audio.mimeType,
            data: piece,
          });
        }
      }
    } catch (error) {
      console.error(`[agent] tts failed in interview ${this.roomId}: ${describeError(error)}`);
    } finally {
      // Always close the reply: with zero chunks the page's drain check
      // completes immediately, so it returns to listening instead of waiting.
      this.sendAgentMessage({ type: "ai-audio-end", replyId });
    }
  }

  private recentHistory(): AiMessage[] {
    return this.history.slice(-MAX_HISTORY_MESSAGES);
  }

  /**
   * Persists one transcript turn. Fire-and-forget: a storage failure must
   * never break the live interview.
   */
  private recordTurn(turn: {
    speaker: "interviewer" | "candidate";
    text: string;
    askedAt: string | null;
    answeredAt: string | null;
    latencyMs: number | null;
  }): void {
    getInterviewRepository()
      .appendTurn(this.roomId, turn)
      .catch((error: unknown) => {
        console.error(`[agent] failed to persist turn: ${describeError(error)}`);
      });
  }

  private sendAgentMessage(message: AgentDataMessage): void {
    const destinations = this.candidateParticipants()
      .map((participant) => participant.info?.identity)
      .filter((identity): identity is string => Boolean(identity));

    if (destinations.length === 0 || this.stopping) {
      console.warn(`[agent] dropped ${message.type} in interview ${this.roomId}: no candidate destinations`);
      return;
    }

    void this.room.localParticipant
      ?.publishData(encodeDataMessage(message), {
        reliable: true,
        destination_identities: destinations,
        topic: AGENT_DATA_TOPIC,
      })
      .then(() => {
        console.log(`[agent] sent ${message.type} to ${destinations.join(",")} (${destinations.length})`);
      })
      .catch((error: unknown) => {
        console.error(`[agent] failed to send message: ${describeError(error)}`);
      });
  }

  private candidateParticipants(): RemoteParticipant[] {
    return [...this.room.remoteParticipants.values()].filter((participant) =>
      (participant.info?.identity ?? "").startsWith(CANDIDATE_IDENTITY_PREFIX),
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Splits base64 into transport-sized pieces (lengths stay multiples of 4). */
function splitBase64(base64: string, maxBytes: number): string[] {
  const step = Math.max(4, Math.floor(maxBytes / 4) * 4);
  const pieces: string[] = [];
  for (let index = 0; index < base64.length; index += step) {
    pieces.push(base64.slice(index, index + step));
  }
  return pieces;
}