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

/**
 * One AI agent participant in one interview room. It joins the LiveKit room,
 * listens for candidate transcripts on the data channel, generates replies
 * through the LLM provider, and broadcasts its messages and status back.
 *
 * Basic conversation only (greeting → candidate speaks → AI replies). There is
 * deliberately no scoring, resume analysis or advanced follow-up logic.
 */

const GREETING_DELAY_MS = 1500;
const EMPTY_ROOM_SHUTDOWN_MS = 10_000;
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT = [
  "You are a professional AI interviewer conducting a live spoken interview.",
  "Keep replies short (2-3 sentences), conversational and warm, because they are spoken aloud.",
  "Ask one natural follow-up question at a time.",
  "Never use markdown, lists or emojis; plain spoken sentences only.",
].join(" ");

const FALLBACK_GREETING =
  "Hello, and thank you for joining. Please tell me a little about yourself.";

const CANDIDATE_IDENTITY_PREFIX = "candidate-";
  
export class InterviewAgentSession {
  /** Called once the session has stopped for any reason. */
  onEnded: (() => void) | null = null;

  private readonly room = new Room();
  private readonly llm = createLlmProvider();
  private history: AiMessage[] = [];
  private isProcessing = false;
  private stopping = false;
  private greetingTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyRoomTimer: ReturnType<typeof setTimeout> | null = null;

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
      `[agent] joined room for interview ${this.roomId} (provider: ${this.llm.name}, candidates: ${this.candidateParticipants().length})`,
    );

    if (this.candidateParticipants().length > 0) {
      this.scheduleGreeting();
    } else {
      this.scheduleEmptyRoomShutdown();
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
        { role: "system", content: SYSTEM_PROMPT },
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

    this.sendAgentMessage({ type: "ai-message", text });
    this.sendAgentMessage({ type: "ai-status", state: "listening" });
  }

  private async handleTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return; // empty speech
    if (this.isProcessing || this.stopping) return; // basic turn-taking

    this.isProcessing = true;
    this.sendAgentMessage({ type: "ai-status", state: "processing" });

    try {
      this.history.push({ role: "user", content: trimmed });
      const reply = await this.llm.generateReply([
        { role: "system", content: SYSTEM_PROMPT },
        ...this.recentHistory(),
      ]);
      this.history.push({ role: "assistant", content: reply.text });
      this.history = this.history.slice(-MAX_HISTORY_MESSAGES);

      this.sendAgentMessage({ type: "ai-message", text: reply.text });
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

  private recentHistory(): AiMessage[] {
    return this.history.slice(-MAX_HISTORY_MESSAGES);
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