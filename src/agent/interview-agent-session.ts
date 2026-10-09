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
/** Grace period after the time-up announcement before the agent leaves. */
const WRAP_UP_GRACE_MS = 45_000;
const DEFAULT_INTERVIEW_MINUTES = 5;

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

/**
 * Interviewer personalities by difficulty level. The extra-hard persona is
 * modelled on how top MNCs run their toughest loops: Amazon's Bar Raiser
 * (deliberately underspecified problems, constraint changes after the first
 * answer, stories drilled with follow-ups until they get thin), Google's
 * recursive depth (defending "why" several levels down with defensible
 * numbers), Meta's mid-session pivots (re-architecting when constraints
 * change live) and Netflix-style blast-radius probing.
 */
const DIFFICULTY_PROMPTS: Record<string, string> = {
  easy: [
    "Interviewer style: easy and welcoming.",
    "- Keep the mood relaxed and encouraging; start with simple introductions.",
    "- Ask one straightforward question at a time, based on things the candidate mentioned themselves.",
    "- Avoid trick questions, pressure or rapid follow-ups.",
    "- If the candidate struggles, gently rephrase or simplify the question and reassure them before moving on.",
  ].join(" "),
  medium: [
    "Interviewer style: balanced and practical.",
    "- Be friendly but focused; ask realistic questions for the role.",
    "- Probe each answer one level deeper (why, what happened next, what was your part in it).",
    "- Expect concrete examples for claims; if none come, note it and move on politely.",
    "- Mix technical, situational and preference questions; keep a steady, fair pace.",
  ].join(" "),
  hard: [
    "Interviewer style: rigorous and direct.",
    "- Dig deep into the candidate's past experience and the problems they have actually solved.",
    "- For every claimed achievement ask for the concrete problem, their specific role, the alternatives they considered, the trade-offs, and the measurable outcome.",
    "- Stack follow-ups to test real depth until the candidate reaches their limit, then move on without sympathy.",
    "- Ask at least one challenging scenario or failure question, and test how they handle not knowing an answer.",
    "- Do not rescue the candidate when they stall; allow a pause, then redirect to a new area.",
  ].join(" "),
  "extra-hard": [
    "Interviewer style: top-MNC bar-raiser panel, the hardest loop.",
    "- Pose deliberately underspecified questions; expect the candidate to clarify scope and state assumptions before answering. If they answer without clarifying, point that out neutrally and ask what they assumed.",
    "- After a first answer, change the constraints (scale 10x, input no longer guaranteed, real-time needed) and see whether they adapt the approach or restart from scratch.",
    "- Chase the why behind every answer, several levels down: why this design, what invariant does it rely on, what breaks without it. Demand defensible numbers, not hand-waving.",
    "- Drill their stories with follow-ups (what exactly did you do, who disagreed, how did you measure success, what would you do differently) until the story gets thin, then push one more level.",
    "- Switch context mid-discussion to test composure, and revisit an earlier answer reworded to check consistency.",
    "- Ask about failure modes and blast radius unprompted: what happens when traffic spikes, when the region goes down, when the cache fills; what does the on-call runbook look like.",
    "- Stay cold and professional: no encouragement, deliberate pauses after weak answers, never reveal whether an answer was right.",
    "- If the candidate is stuck, give at most one minimal hint, then move on and cover a different area.",
  ].join(" "),
};

const FALLBACK_GREETING =
  "Hello, and thank you for joining. Please tell me a little about yourself.";

const WRAP_UP_MESSAGE =
  "Thank you for your time. That brings us to the end of this interview. The recruiter will get back to you with the next steps. Take care.";

const CANDIDATE_IDENTITY_PREFIX = "candidate-";

/** Assembles the interviewer system prompt from the session record. */
function buildSystemPrompt(room: InterviewRoom | null): string {
  if (!room) return BASE_PERSONA_PROMPT;

  const durationMinutes = room.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES;
  const sections: string[] = [BASE_PERSONA_PROMPT, INTERVIEW_CONDUCT_PROMPT];

  sections.push(
    DIFFICULTY_PROMPTS[room.difficulty] ?? DIFFICULTY_PROMPTS.medium,
    [
      "Interview logistics:",
      `Role: ${room.roleTitle ?? "the role"}`,
      room.candidateName ? `Candidate: ${room.candidateName}` : null,
      room.recruiterName ? `Recruiter: ${room.recruiterName}` : null,
      `Scheduled length: ${durationMinutes} minutes. Pace the conversation to cover the key areas within that time, and start wrapping up when roughly one minute remains.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

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
  private interviewTimer: ReturnType<typeof setTimeout> | null = null;
  private wrapUpTimer: ReturnType<typeof setTimeout> | null = null;
  private systemPrompt = BASE_PERSONA_PROMPT;
  private sessionRoom: InterviewRoom | null = null;
  private greetingSent = false;
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
      this.beginInterviewIfNeeded();
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
      this.sessionRoom = room;
      this.systemPrompt = buildSystemPrompt(room);
      const parts = [
        room?.difficulty ? `difficulty:${room.difficulty}` : null,
        room?.durationMinutes ? `duration:${room.durationMinutes}min` : null,
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

  private pendingInterrupt: string | null = null;
  private replyEpoch = 0;
  /** Last two replies the agent spoke — used to recognize echoes of its own voice. */
  private recentSpoken: string[] = [];

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.greetingTimer) clearTimeout(this.greetingTimer);
    if (this.emptyRoomTimer) clearTimeout(this.emptyRoomTimer);
    if (this.interviewTimer) clearTimeout(this.interviewTimer);
    if (this.wrapUpTimer) clearTimeout(this.wrapUpTimer);
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
      // The interview (greeting + duration clock) begins when the first
      // candidate is present, whether they were already here at join or
      // arrived later.
      this.beginInterviewIfNeeded();
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

  /** Starts the greeting + duration clock once, on the first candidate. */
  private beginInterviewIfNeeded(): void {
    if (this.greetingSent || this.greetingTimer) return;
    this.scheduleGreeting();
    this.scheduleInterviewTimer();
  }

  /**
   * Enforces the session duration: when the clock runs out the interviewer
   * announces the wrap-up and leaves after a short grace period, whatever the
   * LLM's own pacing managed.
   */
  private scheduleInterviewTimer(): void {
    if (this.interviewTimer) return;
    const minutes = this.sessionRoom?.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES;
    this.interviewTimer = setTimeout(() => {
      this.interviewTimer = null;
      this.onInterviewTimerFired();
    }, minutes * 60_000);
    console.log(`[agent] interview clock set to ${minutes} min in ${this.roomId}`);
  }

  private onInterviewTimerFired(): void {
    if (this.stopping) return;
    console.log(`[agent] interview time reached in ${this.roomId}, wrapping up`);
    void this.speakReply(WRAP_UP_MESSAGE).then(() => {
      if (this.stopping) return;
      this.wrapUpTimer = setTimeout(() => {
        this.wrapUpTimer = null;
        void this.stop();
      }, WRAP_UP_GRACE_MS);
    });
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
    if (this.isProcessing) return; // the candidate spoke before the greeting fired
    this.isProcessing = true;
    this.greetingSent = true;
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
    this.isProcessing = false;
    this.sendAgentMessage({ type: "ai-status", state: "listening" });

    // An interrupt that arrived during the greeting is answered now.
    const pending = this.pendingInterrupt;
    this.pendingInterrupt = null;
    if (pending) void this.handleTranscript(pending);
  }

  private async handleTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return; // empty speech

    if (this.isProcessing || this.stopping) {
      // Barge-in: the candidate talked over the agent. Cancel whatever reply
      // is being generated or spoken (the epoch bump aborts its speakReply)
      // and queue this speech as the next thing to answer. Short filler
      // ("yes", "okay") and echoes of the agent's own voice never cancel a
      // reply — only substantive speech does.
      if (
        !this.stopping &&
        isSubstantiveSpeech(trimmed) &&
        !this.isEchoOfOwnVoice(trimmed)
      ) {
        this.pendingInterrupt = trimmed;
        this.replyEpoch += 1;
        console.log(`[agent] interrupt received in ${this.roomId}, cancelling current reply`);
      } else {
        console.log(
          `[agent] ignored barge-in candidate transcript in ${this.roomId}: ` +
            (this.stopping ? "stopping" : this.isEchoOfOwnVoice(trimmed) ? "echo" : "backchannel"),
        );
      }
      return;
    }

    this.isProcessing = true;
    this.sendAgentMessage({ type: "ai-status", state: "processing" });

    try {
      let current: string | null = trimmed;
      // Interrupts can arrive while a reply is generated or spoken; each one
      // becomes the next candidate turn, so the conversation follows the
      // candidate instead of talking over them.
      while (current) {
        const turnText = current;
        current = null;

        const answeredAt = new Date().toISOString();
        this.recordTurn({
          speaker: "candidate",
          text: turnText,
          askedAt: this.lastQuestionAskedAt,
          answeredAt,
          latencyMs: this.lastQuestionAskedAt
            ? Date.parse(answeredAt) - Date.parse(this.lastQuestionAskedAt)
            : null,
        });
        this.lastQuestionAskedAt = null;
        this.history.push({ role: "user", content: turnText });

        const reply = await this.llm.generateReply([
          { role: "system", content: this.systemPrompt },
          ...this.recentHistory(),
        ]);

        // An interrupt during the LLM call: the reply it was composing is
        // stale (never spoken, so it stays out of the history) — answer the
        // interrupt instead.
        if (this.pendingInterrupt) {
          current = this.pendingInterrupt;
          this.pendingInterrupt = null;
          this.sendAgentMessage({ type: "ai-status", state: "processing" });
          continue;
        }

        this.history.push({ role: "assistant", content: reply.text });
        this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
        await this.speakReply(reply.text);

        if (this.pendingInterrupt) {
          current = this.pendingInterrupt;
          this.pendingInterrupt = null;
          this.sendAgentMessage({ type: "ai-status", state: "processing" });
        }
      }
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
      this.pendingInterrupt = null;
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
    const replyId = ++this.nextReplyId;
    const epoch = this.replyEpoch;
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
    // speak the text itself (two voices would overlap). replyId lets the page
    // discard pieces of a reply that was interrupted meanwhile.
    this.sendAgentMessage({ type: "ai-message", text, spoken: this.tts.enabled, replyId });
    this.recentSpoken = [text, ...this.recentSpoken].slice(0, 2);
    if (!this.tts.enabled) return;

    let seq = 0;
    let sentence = 0;
    try {
      for (const sentenceText of CloudTtsEngine.splitSentences(text)) {
        if (this.stopping || epoch !== this.replyEpoch) return;
        const audio = await this.tts.synthesizeSentence(sentenceText);
        // The candidate may have interrupted while this sentence synthesized.
        if (this.stopping || epoch !== this.replyEpoch) return;
        const pieces = splitBase64(audio.bytes.toString("base64"), AI_AUDIO_MAX_CHUNK_BYTES);
        for (let piece = 0; piece < pieces.length; piece++) {
          this.sendAgentMessage({
            type: "ai-audio-chunk",
            replyId,
            seq: seq++,
            sentence,
            piece,
            pieces: pieces.length,
            mimeType: audio.mimeType,
            data: pieces[piece],
          });
        }
        sentence += 1;
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

  /**
   * True when a transcript largely repeats what the agent itself just said —
   * the recognizer picking up its own TTS through the candidate's speakers.
   * Such transcripts never cancel a reply; they are dropped entirely.
   */
  private isEchoOfOwnVoice(text: string): boolean {
    if (this.recentSpoken.length === 0) return false;
    const spoken = tokensOf(text);
    if (spoken.size === 0) return true;
    const agent = new Set<string>();
    for (const reply of this.recentSpoken) {
      for (const word of tokensOf(reply)) agent.add(word);
    }
    let overlap = 0;
    for (const word of spoken) {
      if (agent.has(word)) overlap += 1;
    }
    if (overlap / spoken.size > 0.5) return true;
    const normalizedText = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalizedText) return true;
    for (const reply of this.recentSpoken) {
      const normalizedReply = reply.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      if (normalizedReply.includes(normalizedText)) return true;
    }
    return false;
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

const BACKCHANNEL_WORDS = new Set([
  "yes", "yeah", "yep", "no", "nope", "okay", "ok", "hmm", "um", "uh", "right",
  "sure", "alright", "fine", "great", "good", "nice", "thanks", "thank",
  "hello", "hi", "hey", "please", "continue", "go", "on", "so", "well",
]);

/**
 * Barge-in gate on the agent side: only substantive speech cancels a reply
 * that is being generated or spoken. Short acknowledgments and filler are
 * dropped (they are not queued or answered either).
 */
function isSubstantiveSpeech(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const normalized = words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return !normalized.every((word) => BACKCHANNEL_WORDS.has(word));
}

function tokensOf(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
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