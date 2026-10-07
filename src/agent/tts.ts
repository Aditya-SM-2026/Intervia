import "server-only";
import { TextToSpeechClient, type protos } from "@google-cloud/text-to-speech";

/**
 * Google Cloud Text-to-Speech for the cascade pipeline: the Ominibot brain
 * writes the reply text, this engine speaks it. Used inside the agent worker;
 * authenticates via Application Default Credentials locally and via the
 * instance service account on the VM — no keys involved.
 */

export type SentenceAudio = {
  mimeType: string;
  /** Complete audio file bytes for one sentence (MP3). */
  bytes: Buffer;
};

const DEFAULT_VOICE = "en-US-Chirp3-HD-Charon";
const MP3_MIME = "audio/mpeg";

export class CloudTtsEngine {
  private readonly client: TextToSpeechClient | null;
  private readonly voiceName: string;

  constructor(enabled: boolean) {
    this.voiceName = process.env.CLOUD_TTS_VOICE?.trim() || DEFAULT_VOICE;
    this.client = enabled ? new TextToSpeechClient() : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Splits a spoken reply into sentences, grouping very short ones. */
  static splitSentences(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parts = trimmed
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const grouped: string[] = [];
    for (const part of parts) {
      const previous = grouped[grouped.length - 1];
      if (previous && (previous.length < 40 || part.length < 40)) {
        grouped[grouped.length - 1] = `${previous} ${part}`;
      } else {
        grouped.push(part);
      }
    }
    return grouped;
  }

  async synthesizeSentence(sentence: string): Promise<SentenceAudio> {
    if (!this.client) throw new Error("Cloud TTS is not enabled in this worker.");
    const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
      input: { text: sentence },
      voice: {
        languageCode: this.voiceName.split("-").slice(0, 2).join("-"),
        name: this.voiceName,
      },
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
    };
    const [response] = await this.client.synthesizeSpeech(request);
    if (!response.audioContent?.length) {
      throw new Error("Cloud TTS returned no audio for a sentence.");
    }
    return { mimeType: MP3_MIME, bytes: Buffer.from(response.audioContent) };
  }
}