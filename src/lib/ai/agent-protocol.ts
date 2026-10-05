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
  | { type: "ai-message"; text: string };

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
    return { type: "ai-message", text: message.text };
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