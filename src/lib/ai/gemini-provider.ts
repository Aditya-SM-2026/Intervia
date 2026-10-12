import "server-only";
import type { AiMessage, LlmProvider, LlmProviderName, ProviderResponse } from "./ai.types";

/**
 * Google Gemini (AI Studio) provider, used for the evaluation-scores pass.
 * Chosen by the Phase 0 benchmark (tools/score-benchmark): the flash-lite
 * tier returned JSON-valid, well-calibrated scores at ~2s median latency.
 *
 * Reply-shape note: generation is pinned to `application/json` because every
 * current call site parses the reply as JSON; the prompt still carries the
 * full schema instructions.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiProviderOptions {
  timeoutMs?: number;
  /** Primary model; GEMINI_SCORER_MODEL overrides the default. */
  model?: string;
  /** Used once when the primary model is unavailable (429/500/503). */
  fallbackModel?: string;
}

function resolveModels(options?: GeminiProviderOptions): { primary: string; fallback: string | null } {
  const primary = options?.model ?? process.env.GEMINI_SCORER_MODEL ?? DEFAULT_MODEL;
  const fallback = options?.fallbackModel
    ?? (primary === DEFAULT_FALLBACK_MODEL ? null : DEFAULT_FALLBACK_MODEL);
  return { primary, fallback };
}

async function callModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured for the Gemini provider.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            maxOutputTokens: 3000,
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      const error = new Error(`Gemini API error (HTTP ${response.status}): ${detail}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (!text) throw new Error("Gemini API returned an empty response.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function createGeminiProvider(options?: GeminiProviderOptions): LlmProvider {
  const name: LlmProviderName = "gemini";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name,
    async generateReply(messages: readonly AiMessage[]): Promise<ProviderResponse> {
      const systemPrompt = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const userPrompt = messages
        .filter((message) => message.role !== "system")
        .map((message) => message.content)
        .join("\n\n");

      const { primary, fallback } = resolveModels(options);
      try {
        const text = await callModel(primary, systemPrompt, userPrompt, timeoutMs);
        return { text, provider: name, model: primary };
      } catch (cause) {
        const status = (cause as Error & { status?: number }).status;
        const retriable = status === 429 || status === 500 || status === 503 || status === undefined;
        if (!fallback || !retriable) throw cause;
        console.warn(`[gemini] model ${primary} unavailable (HTTP ${status ?? "network"}); retrying with ${fallback}`);
        const text = await callModel(fallback, systemPrompt, userPrompt, timeoutMs);
        return { text, provider: name, model: fallback };
      }
    },
  };
}