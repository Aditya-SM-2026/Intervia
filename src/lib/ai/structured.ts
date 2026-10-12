import "server-only";
import type { z } from "zod";
import { getGeminiTextConfig } from "@/lib/config/env";
import { LlmError } from "./llm-error";
import { isOminibotConfigured, ominibotChat } from "./ominibot";

/**
 * Structured (JSON) generation for the offline pipelines: interview plans and
 * everything on the dashboard (scorecard, resume match, own-answer signals).
 *
 * Ominibot is used when OMINIBOT_API_KEY is set, with the Gemini text model
 * as the fallback; ANALYSIS_PROVIDER=gemini reverses the order. The output is
 * always validated against a Zod schema; a reply that does not parse is
 * retried once, then the other provider is tried, and only then is it
 * reported as an error. It is never passed on unvalidated.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  temperature?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

type Provider = "ominibot" | "gemini";

/** The configured providers, in the order they are tried. */
export function analysisProviders(): Provider[] {
  const available: Provider[] = [];
  if (isOminibotConfigured()) available.push("ominibot");
  if (getGeminiTextConfig() !== null) available.push("gemini");
  const preferred = (process.env.ANALYSIS_PROVIDER ?? "").trim().toLowerCase();
  return preferred === "gemini" ? available.reverse() : available;
}

/** True when some real LLM is configured. */
export function isStructuredLlmAvailable(): boolean {
  return analysisProviders().length > 0;
}

export async function generateStructured<T>(
  request: StructuredRequest<T>,
): Promise<StructuredResult<T>> {
  const providers = analysisProviders();
  if (providers.length === 0) {
    throw new LlmError("No LLM is configured. Set OMINIBOT_API_KEY or GEMINI_API_KEY.", {
      status: 400,
    });
  }

  let lastError: unknown = null;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { text, model } = await generateJsonText(provider, request);
        const parsed = request.schema.safeParse(parseJson(text));
        if (parsed.success) return { data: parsed.data, model };
        lastError = new LlmError(
          `LLM reply did not match the expected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        );
      } catch (error) {
        lastError = error;
        // Configuration and auth problems will not improve on a retry.
        if (error instanceof LlmError && error.status !== undefined && error.status < 500) break;
      }
    }
    console.warn(
      `[llm] ${provider} did not produce a usable reply: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  throw lastError instanceof Error ? lastError : new LlmError("LLM request failed.");
}

async function generateJsonText<T>(
  provider: Provider,
  request: StructuredRequest<T>,
): Promise<{ text: string; model: string }> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (provider === "ominibot") {
    const reply = await ominibotChat({
      system: `${request.system}\n\nReply with a single JSON object and nothing else.`,
      content: request.user,
      json: true,
      temperature: request.temperature ?? 0.2,
      timeoutMs,
    });
    return { text: reply.text, model: reply.model };
  }

  const gemini = getGeminiTextConfig();
  if (!gemini) throw new LlmError("GEMINI_API_KEY is not set.", { status: 400 });

  let response: Response;
  try {
    response = await fetch(`${GEMINI_BASE_URL}/models/${gemini.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": gemini.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: request.temperature ?? 0.2,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmError("LLM service request timed out.");
    }
    throw new LlmError("Could not reach the LLM service.", { cause: error });
  }
  if (!response.ok) {
    throw new LlmError(`LLM service returned ${response.status} ${response.statusText}.`, {
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new LlmError("LLM service returned an empty response.");
  return { text, model: gemini.model };
}

/** Parses a JSON object out of a model reply, tolerating code fences. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
