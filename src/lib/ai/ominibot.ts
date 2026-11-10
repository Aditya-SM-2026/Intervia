import "server-only";
import { getLlmConfig } from "@/lib/config/env";
import { LlmError } from "./llm-error";

/**
 * Ominibot chat completions (OpenAI-compatible, one routed model, "ominibot").
 * Verified against the live API on 2026-10-12: JSON mode works, and a message
 * may carry images and video as base64 data URLs.
 */

export type OminibotPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface OminibotRequest {
  system?: string;
  content: string | OminibotPart[];
  /** Ask for a single JSON object as the reply. */
  json?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export interface OminibotReply {
  text: string;
  model: string;
  /** What the request cost, as reported by the service; null when not reported. */
  costUsd: number | null;
}

export function isOminibotConfigured(): boolean {
  return Boolean(process.env.OMINIBOT_API_KEY?.trim()) &&
    (process.env.OMINIBOT_PROVIDER ?? "").trim().toLowerCase() !== "mock";
}

export async function ominibotChatStream(
  request: OminibotRequest,
  onDelta: (text: string) => void,
): Promise<OminibotReply> {
  const config = getLlmConfig();
  const timeoutMs = request.timeoutMs ?? config.timeoutMs;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.content },
        ],
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmError("Ominibot request timed out.");
    }
    throw new LlmError("Could not reach Ominibot.", { cause: error });
  }

  if (!response.ok) {
    throw new LlmError(`Ominibot returned ${response.status} ${response.statusText}.`, {
      status: response.status,
    });
  }
  if (!response.body) throw new LlmError("Ominibot returned an unreadable stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let model = config.model;
  let costUsd: number | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const payload = JSON.parse(raw) as {
        model?: string;
        choices?: { delta?: { content?: string | null } }[];
        usage?: { cost?: number };
      };
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        onDelta(delta);
      }
      if (payload.model) model = payload.model;
      if (typeof payload.usage?.cost === "number") costUsd = payload.usage.cost;
    } catch {
      // Ignore a malformed SSE event and keep the rest of the stream.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer);

  if (!text) throw new LlmError("Ominibot returned an empty response.");
  return { text, model, costUsd };
}

export async function ominibotChat(request: OminibotRequest): Promise<OminibotReply> {
  const config = getLlmConfig();
  const timeoutMs = request.timeoutMs ?? config.timeoutMs;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.content },
        ],
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmError("Ominibot request timed out.");
    }
    throw new LlmError("Could not reach Ominibot.", { cause: error });
  }

  if (!response.ok) {
    // A short safe message; never the key or the payload.
    throw new LlmError(`Ominibot returned ${response.status} ${response.statusText}.`, {
      status: response.status,
    });
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { cost?: number };
    error?: { message?: string };
  };
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new LlmError(
      payload.error?.message
        ? `Ominibot error: ${payload.error.message.slice(0, 200)}`
        : "Ominibot returned an empty response.",
    );
  }
  return {
    text,
    model: payload.model ?? config.model,
    costUsd: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
  };
}
