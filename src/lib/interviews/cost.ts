import type { SessionOutcome } from "./interview.types";

/**
 * Estimated cost of the live voice model for one interview, from the token
 * usage the agent recorded. An estimate, not an invoice: it applies list
 * prices to reported tokens and leaves out plan generation and scoring.
 *
 * Gemini Live bills every token in the session's remembered context again on
 * each reply, so these totals already include that repetition.
 */

/** USD per one million tokens, Gemini 3.8 Live list prices (October 2026). */
const RATES = {
  audioInput: 3.0,
  textInput: 0.75,
  audioOutput: 12.0,
  textOutput: 4.5,
};

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
  for (const raw of outcome.usage) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const audioIn = count(entry, "input_audio_tokens");
    const audioOut = count(entry, "output_audio_tokens");
    // Anything not reported as audio is priced as text.
    const textIn = Math.max(0, count(entry, "input_tokens") - audioIn);
    const textOut = Math.max(0, count(entry, "output_tokens") - audioOut);
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
