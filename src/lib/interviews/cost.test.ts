// Run with: npm test  (node --test, no model or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateVoiceCost } from "./cost.ts";
import type { SessionOutcome } from "./interview.types.ts";

function outcome(usage: unknown[], elapsedSeconds = 3600): SessionOutcome {
  return { usage, elapsedSeconds } as unknown as SessionOutcome;
}

const livekitSummary = {
  type: "realtime_model_usage",
  input_tokens: 1_000_000,
  input_audio_tokens: 400_000,
  output_tokens: 100_000,
  output_audio_tokens: 90_000,
};

test("an interview with only LiveKit's summary is priced from it", () => {
  const cost = estimateVoiceCost(outcome([livekitSummary]));
  // 0.4M audio in x $3 + 0.6M text in x $0.75 + 0.09M audio out x $12 + 0.01M text out x $4.5
  assert.ok(cost);
  assert.equal(cost.usd.toFixed(4), (1.2 + 0.45 + 1.08 + 0.045).toFixed(4));
});

test("the agent's full count replaces LiveKit's summary and adds thinking and tool tokens", () => {
  const full = {
    type: "gemini_live_usage",
    input_tokens: 1_000_000,
    input_audio_tokens: 400_000,
    output_tokens: 100_000,
    output_audio_tokens: 90_000,
    thoughts_tokens: 50_000,
    tool_use_prompt_tokens: 20_000,
  };
  const cost = estimateVoiceCost(outcome([livekitSummary, full]));
  assert.ok(cost);
  // As above, plus 0.02M tool-use input x $0.75 and 0.05M thinking x $4.5; the summary is not counted again.
  assert.equal(cost.usd.toFixed(4), (1.2 + 0.45 + 0.015 + 1.08 + 0.045 + 0.225).toFixed(4));
  assert.equal(cost.usdPerHour?.toFixed(4), cost.usd.toFixed(4));
});
