import type { SessionOutcome } from "./interview.types";

/**
 * Estimated cost of the live voice model for one interview, from the token
 * usage the agent recorded. It applies list prices to the tokens Gemini
 * reported and leaves out plan generation and scoring.
 *
 * Gemini Live bills every token in the session's remembered context again on
 * each reply, so these totals already include that repetition.
 *
 * Newer interviews carry a "gemini_live_usage" entry: the agent's own count
 * of every usage report Gemini sent, thinking and tool-use tokens included.
 * When it is there it is the only entry priced. Older interviews only have
 * LiveKit's summary, which leaves those tokens out and so reads low.
 */

/**
 * USD per one million tokens, Gemini 3.8 Live list prices (October 2026).
 * Thinking tokens are billed as output; they are priced at the text rate.
 */
const RATES = {
  audioInput: 3.0,
  textInput: 0.75,
  audioOutput: 12.0,
  textOutput: 4.5,
};

/** The agent's complete count of Gemini usage reports (see the comment above). */
const FULL_COUNT_TYPE = "gemini_live_usage";

export interface VoiceCostEstimate {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Null when the interview was too short for an hourly rate to mean much. */
  usdPerHour: number | null;
}

function count(entry: Record<string, unknown>, key: string): number {
  const value = entry[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function estimateVoiceCost(outcome: SessionOutcome | null): VoiceCostEstimate | null {
  if (!outcome || outcome.usage.length === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;
  const entries = outcome.usage.filter(
    (raw): raw is Record<string, unknown> => typeof raw === "object" && raw !== null,
  );
  const full = entries.filter((entry) => entry.type === FULL_COUNT_TYPE);
  for (const entry of full.length > 0 ? full : entries) {
    const audioIn = count(entry, "input_audio_tokens");
    const audioOut = count(entry, "output_audio_tokens");
    // Anything not reported as audio is priced as text. Tool-use prompts are
    // input; thinking is output. Both are only in the agent's full count.
    const textIn =
      Math.max(0, count(entry, "input_tokens") - audioIn) + count(entry, "tool_use_prompt_tokens");
    const textOut =
      Math.max(0, count(entry, "output_tokens") - audioOut) + count(entry, "thoughts_tokens");
    inputTokens += audioIn + textIn;
    outputTokens += audioOut + textOut;
    usd +=
      (audioIn * RATES.audioInput +
        textIn * RATES.textInput +
        audioOut * RATES.audioOutput +
        textOut * RATES.textOutput) /
      1_000_000;
  }
  if (inputTokens + outputTokens === 0) return null;

  return {
    inputTokens,
    outputTokens,
    usd,
    usdPerHour: outcome.elapsedSeconds >= 60 ? (usd / outcome.elapsedSeconds) * 3600 : null,
  };
}
