/**
 * Gemini Live voice session in the browser: streams the microphone to the
 * Live API and plays the model's spoken replies. One ephemeral token per
 * session (issued by /api/ai/live-token, persona locked server-side).
 *
 * Audio in:  getUserMedia → AudioWorklet → PCM 16k chunks → sendRealtimeInput
 * Audio out: modelTurn PCM 24k → scheduled AudioBufferSourceNode playback,
 *            cancelled on server "interrupted" (barge-in).
 */
import {
  GoogleGenAI,
  Modality,
  EndSensitivity,
  StartSensitivity,
  type Session,
  type LiveServerMessage,
} from "@google/genai";

export const GEMINI_LIVE_TOKEN_ENDPOINT = "/api/ai/live-token";

export interface GeminiLiveVoiceCallbacks {
  onStatus(state: "connecting" | "listening" | "speaking" | "error" | "disconnected", detail?: string): void;
  onTranscript(role: "interviewer" | "candidate", text: string): void;
}

export interface GeminiLiveVoiceHandle {
  stop(): void;
}

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;
const CAPTURE_CHUNK_SAMPLES = 1024;

const CAPTURE_WORKLET_CODE = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(${CAPTURE_CHUNK_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(${CAPTURE_CHUNK_SAMPLES});
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16-capture", Pcm16Capture);
`;

function pcm16Base64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

export async function startGeminiLiveVoice(
  callbacks: GeminiLiveVoiceCallbacks,
): Promise<GeminiLiveVoiceHandle> {
  let session: Session | null = null;
  let micStream: MediaStream | null = null;
  let captureContext: AudioContext | null = null;
  let playbackContext: AudioContext | null = null;
  let stopped = false;

  const scheduledSources: AudioBufferSourceNode[] = [];
  let nextPlaybackTime = 0;
  let modelReplyBuffer = "";
  let candidateSpeechBuffer = "";

  const flushModelReply = () => {
    const text = modelReplyBuffer.trim();
    modelReplyBuffer = "";
    if (text) callbacks.onTranscript("interviewer", text);
  };

  const flushCandidateSpeech = () => {
    const text = candidateSpeechBuffer.trim();
    candidateSpeechBuffer = "";
    if (text) callbacks.onTranscript("candidate", text);
  };

  const flushAllTranscripts = () => {
    flushCandidateSpeech();
    flushModelReply();
  };

  const stopScheduledPlayback = () => {
    const now = playbackContext?.currentTime ?? 0;
    for (const source of scheduledSources) {
      try {
        source.stop(now);
      } catch {
        // Already finished or never started.
      }
    }
    scheduledSources.length = 0;
    nextPlaybackTime = 0;
  };

  const playAudioChunk = (base64: string) => {
    if (!playbackContext) return;
    const samples = base64ToFloat32(base64);
    if (samples.length === 0) return;
    const buffer = playbackContext.createBuffer(1, samples.length, PLAYBACK_RATE);
    buffer.getChannelData(0).set(samples);
    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);
    const startAt = Math.max(playbackContext.currentTime + 0.03, nextPlaybackTime);
    source.start(startAt);
    nextPlaybackTime = startAt + buffer.duration;
    scheduledSources.push(source);
    callbacks.onStatus("speaking");
  };

  callbacks.onStatus("connecting");

  try {
    const response = await fetch(GEMINI_LIVE_TOKEN_ENDPOINT, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message ?? "Could not obtain a Live session token.");
    }

    const ai = new GoogleGenAI({
      apiKey: data.token as string,
      httpOptions: { apiVersion: "v1alpha" },
    });

    session = await ai.live.connect({
      model: data.model as string,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
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
      callbacks: {
        onopen: () => {
          if (!stopped) callbacks.onStatus("listening");
        },
onmessage: (message: LiveServerMessage) => {
          if (stopped) return;

          // Input transcription streams piece by piece while the user speaks;
          // accumulate into one transcript entry per turn.
          const inputText = message.serverContent?.inputTranscription?.text;
          if (inputText) candidateSpeechBuffer += inputText;

          const outputText = message.serverContent?.outputTranscription?.text;
          if (outputText) modelReplyBuffer += outputText;

          const content = message.serverContent;
          if (content?.interrupted) {
            stopScheduledPlayback();
            flushAllTranscripts();
            callbacks.onStatus("listening");
          }
          const audioParts = content?.modelTurn?.parts ?? [];
          for (const part of audioParts) {
            const audio = part.inlineData?.data;
            if (audio) playAudioChunk(audio);
          }
          if (content?.turnComplete || content?.generationComplete) {
            flushAllTranscripts();
            callbacks.onStatus("listening");
          }
          if (message.goAway) {
            // The server will close this session soon; treat it as an end for
            // now. Automatic resume is future work.
            flushAllTranscripts();
          }
        },
        onerror: (event: ErrorEvent) => {
          callbacks.onStatus("error", event.message || "Live session error.");
        },
        onclose: (event: CloseEvent) => {
          if (stopped) return;
          callbacks.onStatus(
            event.wasClean ? "disconnected" : "error",
            event.wasClean ? undefined : `Live session closed (code ${event.code}).`,
          );
        },
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not start the Live session.";
    callbacks.onStatus("error", message);
    throw cause;
  }

  // Microphone capture.
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  captureContext = new AudioContext({ sampleRate: CAPTURE_RATE });
  const workletUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET_CODE], { type: "application/javascript" }),
  );
  await captureContext.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const source = captureContext.createMediaStreamSource(micStream);
  const node = new AudioWorkletNode(captureContext, "pcm16-capture");
  const silence = captureContext.createGain();
  silence.gain.value = 0;
  source.connect(node);
  node.connect(silence).connect(captureContext.destination);
  node.port.onmessage = (event: MessageEvent) => {
    if (stopped || !session) return;
    const chunk = new Int16Array(event.data as ArrayBuffer);
    session.sendRealtimeInput({
      media: { data: pcm16Base64(chunk), mimeType: "audio/pcm;rate=16000" },
    });
  };

  playbackContext = new AudioContext({ sampleRate: PLAYBACK_RATE });
  void playbackContext.resume();

  return {
    stop() {
      stopped = true;
      stopScheduledPlayback();
      try {
        session?.close();
      } catch {
        // Session may already be closed.
      }
      micStream?.getTracks().forEach((track) => track.stop());
      void captureContext?.close();
      void playbackContext?.close();
      captureContext = null;
      playbackContext = null;
    },
  };
}