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
 * Gemini Live configuration (real-time voice). "studio" uses the Gemini API
 * key; "vertex" uses Application Default Credentials / service accounts and
 * bills to the GCP project.
 */

const geminiLiveSchema = z.object({
  apiKey: z.string().min(1, "GEMINI_API_KEY is empty"),
  backend: z.enum(["studio", "vertex"]),
  project: z.string().optional(),
  location: z.string().optional(),
  model: z.string().min(1, "GEMINI_LIVE_MODEL is empty"),
});

const DEFAULT_GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";

export type GeminiLiveConfig = z.infer<typeof geminiLiveSchema>;

export function getGeminiLiveConfig(): GeminiLiveConfig {
  const backend = (process.env.GEMINI_BACKEND?.trim() || "studio").toLowerCase();
  const parsed = geminiLiveSchema.safeParse({
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    backend,
    project: process.env.GOOGLE_CLOUD_PROJECT?.trim() || undefined,
    location: process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1",
    model: process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid Gemini Live configuration. Check the GEMINI_* variables in .env. Details: ${issues}`,
    );
  }

  if (parsed.data.backend === "vertex" && !parsed.data.project) {
    throw new Error(
      "GEMINI_BACKEND=vertex requires GOOGLE_CLOUD_PROJECT to be set in .env.",
    );
  }

  return parsed.data;
}
