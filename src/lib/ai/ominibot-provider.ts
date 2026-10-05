import "server-only";
import { z } from "zod";
import type { AiMessage, LlmProvider, ProviderResponse } from "./ai.types";
import { LlmError } from "./llm-error";
import type { LlmConfig } from "@/lib/config/env";

/**
 * Ominibot provider adapter.
 *
 * Integration status (documented, not guessed):
 * - VERIFIED by direct probe (no key): the service exposes an OpenAI-style API
 *   under https://api.ominibot.com/v1 — unauthenticated requests to
 *   /v1/models return 401 with {"error":{"message","type":"authentication_error"}}.
 * - From project integration notes: it is OpenAI-compatible Chat Completions
 *   with Bearer auth (omk_ key) and models such as "ominibot/ominibot".
 * - ASSUMED (validate with a real key before Phase 4): the request body and
 *   response shape follow the OpenAI Chat Completions format, streaming is
 *   available but not needed yet, and the service returns TEXT ONLY — no
 *   built-in speech-to-text or text-to-speech. TODO(Phase 4): verify audio
 *   support and TTS against the real API with the key; add a separate
 *   speech pipeline if the answers are no.
 */

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
});

type ChatCompletion = z.infer<typeof chatCompletionSchema>;

function parseCompletion(payload: unknown): ChatCompletion {
  const parsed = chatCompletionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LlmError("Unexpected response format from the LLM service.");
  }
  return parsed.data;
}
  
export function createOminibotProvider(config: LlmConfig): LlmProvider {
  return {
    name: "ominibot",

    async generateReply(messages: readonly AiMessage[]): Promise<ProviderResponse> {
      let response: Response;

      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model: config.model, messages }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new LlmError("LLM service request timed out.");
        }
        throw new LlmError("Could not reach the LLM service.", { cause: error });
      }

      if (!response.ok) {
        // Pass on a short safe message; never echo the key or full payloads.
        throw new LlmError(
          `LLM service returned ${response.status} ${response.statusText}.`,
          { status: response.status },
        );
      }

      const completion = parseCompletion(await response.json());
      const content = completion.choices[0].message.content?.trim() ?? "";

      if (!content) {
        throw new LlmError("LLM service returned an empty response.");
      }

      return {
        text: content,
        provider: "ominibot",
        model: completion.model ?? config.model,
      };
    },
  };
}