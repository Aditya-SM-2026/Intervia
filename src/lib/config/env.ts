import "server-only";
import { z } from "zod";

/**
 * LLM (Ominibot) configuration. Server-only: the API key must never reach the
 * browser. Values are parsed lazily with clear messages, because the key is
 * legitimately absent while running with the mock provider.
 */

const llmSchema = z.object({
  apiKey: z.string().min(1, "OMINIBOT_API_KEY is empty"),
  baseUrl: z.url("OMINIBOT_API_BASE_URL must be a valid URL"),
  model: z.string().min(1, "OMINIBOT_MODEL is empty"),
  timeoutMs: z.number().int().positive(),
});

const API_TIMEOUT_MS = 30_000;

export type LlmConfig = z.infer<typeof llmSchema>;

function providerChoice(): "ominibot" | "mock" {
  const raw = (process.env.OMINIBOT_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "mock") return "mock";
  if (raw === "ominibot") return "ominibot";
  // Default: use Ominibot when a key exists, otherwise fall back to the mock
  // provider so the app stays runnable before the key is added.
  return process.env.OMINIBOT_API_KEY?.trim() ? "ominibot" : "mock";
}

export function getLlmProviderName(): "ominibot" | "mock" {
  return providerChoice();
}

export function getLlmConfig(): LlmConfig {
  const parsed = llmSchema.safeParse({
    apiKey: process.env.OMINIBOT_API_KEY?.trim() ?? "",
    baseUrl: process.env.OMINIBOT_API_BASE_URL?.trim() || "https://api.ominibot.com/v1",
    model: process.env.OMINIBOT_MODEL?.trim() || "ominibot",
    timeoutMs: Number(process.env.OMINIBOT_TIMEOUT_MS?.trim()) || API_TIMEOUT_MS,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid Ominibot configuration. Check the OMINIBOT_* variables in .env. Details: ${issues}`,
    );
  }

  return parsed.data;
}

/**
 * Gemini text model, used for interview-plan generation and scorecards. The
 * live voice session itself runs in the agent worker (agent/), which reads
 * the same GEMINI_API_KEY from the shared env file.
 */
export interface GeminiTextConfig {
  apiKey: string;
  model: string;
}

const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.8-flash";

/** Null when no Gemini key is configured (callers fall back or report it). */
export function getGeminiTextConfig(): GeminiTextConfig | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL,
  };
}

/**
 * Shared secret the agent worker presents on /api/agent/*. Null when unset:
 * the agent API then only answers in development.
 */
export function getAgentApiSecret(): string | null {
  return process.env.AGENT_API_SECRET?.trim() || null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
