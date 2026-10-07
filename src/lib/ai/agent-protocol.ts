/**
 * Shared contract between the AI agent worker (Node) and the candidate page
 * (browser). Both sides exchange JSON over LiveKit data messages on one topic.
 * Contains no secrets.
 */

export const AI_AGENT_IDENTITY = "ai-interviewer";
export const AGENT_DATA_TOPIC = "interview-ai";

/** Status states the agent broadcasts; the page shows them as the AI status. */
export type AgentStatusState = "listening" | "processing" | "speaking" | "error";

export type AgentDataMessage =
  | { type: "ai-status"; state: AgentStatusState; detail?: string }
  | { type: "ai-message"; text: string; spoken?: boolean }
  /**
   * One piece of spoken reply audio (base64 of a complete audio segment, e.g.
   * an MP3 sentence synthesized by the worker). replyId groups the pieces of
   * one reply; seq orders them. The last piece is followed by ai-audio-end.
   */
  | { type: "ai-audio-chunk"; replyId: number; seq: number; mimeType: string; data: string }
  | { type: "ai-audio-end"; replyId: number };

export const AI_AUDIO_MAX_CHUNK_BYTES = 12 * 1024;

export type CandidateDataMessage = {
  type: "candidate-transcript";
  text: string;
};

export function encodeDataMessage(
  message: AgentDataMessage | CandidateDataMessage,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(message));
}

function decodeJson(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

export function decodeAgentDataMessage(payload: Uint8Array): AgentDataMessage | null {
  const value = decodeJson(payload);
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;

  if (message.type === "ai-status") {
    const state = message.state;
    if (state === "listening" || state === "processing" || state === "speaking" || state === "error") {
      return {
        type: "ai-status",
        state,
        detail: typeof message.detail === "string" ? message.detail : undefined,
      };
    }
    return null;
  }

  if (message.type === "ai-message" && typeof message.text === "string") {
    return {
      type: "ai-message",
      text: message.text,
      spoken: message.spoken === true ? true : undefined,
    };
  }

  if (
    message.type === "ai-audio-chunk" &&
    typeof message.replyId === "number" &&
    typeof message.seq === "number" &&
    typeof message.mimeType === "string" &&
    typeof message.data === "string"
  ) {
    return {
      type: "ai-audio-chunk",
      replyId: message.replyId,
      seq: message.seq,
      mimeType: message.mimeType,
      data: message.data,
    };
  }

  if (message.type === "ai-audio-end" && typeof message.replyId === "number") {
    return { type: "ai-audio-end", replyId: message.replyId };
  }

  return null;
}

export function decodeCandidateDataMessage(payload: Uint8Array): CandidateDataMessage | null {
  const value = decodeJson(payload);
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;

  if (message.type === "candidate-transcript" && typeof message.text === "string") {
    return { type: "candidate-transcript", text: message.text };
  }
  return null;
}