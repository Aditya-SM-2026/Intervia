import "server-only";
import { NextResponse } from "next/server";
import { GoogleGenAI, Modality, EndSensitivity, StartSensitivity } from "@google/genai";
import { getGeminiLiveConfig } from "@/lib/config/env";
import { INTERVIEWER_SYSTEM_PROMPT } from "@/lib/ai-live/interviewer-prompt";

/**
 * Issues a short-lived Gemini Live ephemeral token. The real key stays on the
 * server; the browser uses the token once. The interviewer persona, modalities
 * and transcription settings are locked into the token via
 * liveConnectConstraints so the client cannot change them.
 */


export async function POST() {
  let config;
  try {
    config = getGeminiLiveConfig();
  } catch (cause) {
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: (cause as Error).message } },
      { status: 503 },
    );
  }

  const client =
    config.backend === "vertex"
      ? new GoogleGenAI({
          vertexai: true,
          project: config.project,
          location: config.location,
        })
      : new GoogleGenAI({ apiKey: config.apiKey });

  try {
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: config.model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: INTERVIEWER_SYSTEM_PROMPT,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            temperature: 0.8,
            speechConfig: { languageCode: "en-US" },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                prefixPaddingMs: 100,
                silenceDurationMs: 300,
              },
            },
          },
        },
      },
    });

    if (!token.name) {
      throw new Error("The Gemini API did not return an ephemeral token.");
    }
    return NextResponse.json({ token: token.name, model: config.model }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not create a Live session token.";
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message } },
      { status: 502 },
    );
  }
}

