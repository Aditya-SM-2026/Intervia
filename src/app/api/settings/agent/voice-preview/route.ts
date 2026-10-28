import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { getGeminiTextConfig } from "@/lib/config/env";
import { AGENT_VOICES, VOICE_SAMPLE_TEXT, type AgentVoiceOption } from "@/lib/agent/agent-voices";

/**
 * Plays a short sample of an interviewer voice, so a recruiter can hear it
 * before choosing it in Settings.
 *
 * The sample is spoken by Gemini's text-to-speech endpoint using the same
 * prebuilt voice the live interview will use ("the voice profile is shared
 * between Live API and TTS"), then wrapped as a WAV for the browser. Results
 * are cached in memory: each voice is synthesized once per server process.
 *
 * Recruiter-only: the API key stays server-side.
 */

export const dynamic = "force-dynamic";

const DEFAULT_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.1-flash-tts",
  "gemini-2.5-flash-preview-tts",
] as const;
const SAMPLE_CACHE = new Map<string, { audio: Buffer; contentType: string }>();

function failure(message: string, status: number) {
  return NextResponse.json({ error: { code: "VOICE_PREVIEW_FAILED", message } }, { status });
}

interface TtsResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
  }>;
  error?: { message?: string };
}

/** Wraps raw 16-bit PCM in a minimal WAV header. */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function toBrowserAudio(
  data: Buffer,
  mimeType: string,
): { audio: Buffer; contentType: string } {
  const lower = mimeType.toLowerCase();
  if (lower.includes("wav")) {
    return { audio: data, contentType: "audio/wav" };
  }
  if (lower.includes("pcm") || lower.includes("l16")) {
    const rate = Number(/rate=(\d+)/.exec(lower)?.[1]) || 24_000;
    return { audio: pcmToWav(data, rate), contentType: "audio/wav" };
  }
  return { audio: data, contentType: mimeType || "audio/wav" };
}

async function synthesize(voice: AgentVoiceOption, apiKey: string, model: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: VOICE_SAMPLE_TEXT }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.geminiVoice } },
          },
        },
        model,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const payload = (await response.json().catch(() => null)) as TtsResponse | null;
  if (!response.ok) {
    const detail = payload?.error?.message ?? `Gemini TTS responded ${response.status}.`;
    const missing = response.status === 404 || /not found|not supported/i.test(detail);
    throw Object.assign(new Error(detail), { modelMissing: missing });
  }

  const inline = payload?.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.inlineData)
    .find((part): part is { mimeType?: string; data?: string } => Boolean(part?.data));

  if (!inline?.data) throw new Error("Gemini TTS returned no audio.");
  return toBrowserAudio(Buffer.from(inline.data, "base64"), inline.mimeType ?? "audio/wav");
}

export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const requested = request.nextUrl.searchParams.get("voice") ?? "";
  const voice = AGENT_VOICES.find((option) => option.id === requested);
  if (!voice) return failure("Unknown voice.", 400);

  const config = getGeminiTextConfig();
  if (!config) {
    return failure("Voice previews are not configured: set GEMINI_API_KEY on the server.", 503);
  }

  const configured = process.env.GEMINI_TTS_MODEL?.trim();
  const models = configured ? [configured] : [...DEFAULT_TTS_MODELS];
  const cacheKey = voice.id;
  const cached = SAMPLE_CACHE.get(cacheKey);
  if (cached) {
    return new NextResponse(new Uint8Array(cached.audio), {
      headers: {
        "content-type": cached.contentType,
        "content-length": String(cached.audio.length),
        "cache-control": "private, max-age=86400",
      },
    });
  }

  try {
    let lastError: Error | null = null;
    for (const model of models) {
      try {
        const sample = await synthesize(voice, config.apiKey, model);
        SAMPLE_CACHE.set(cacheKey, sample);
        return new NextResponse(new Uint8Array(sample.audio), {
          headers: {
            "content-type": sample.contentType,
            "content-length": String(sample.audio.length),
            "cache-control": "private, max-age=86400",
          },
        });
      } catch (error) {
        lastError = error as Error;
        // Try the next model only when this one does not exist on the key.
        if (!(error as { modelMissing?: boolean }).modelMissing) throw error;
      }
    }
    throw lastError ?? new Error("No speech model is available.");
  } catch (error) {
    console.error(`[voice-preview] ${voice.id} failed: ${(error as Error).message}`);
    return failure("Could not generate the voice sample. Please try again.", 502);
  }
}
