"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startGeminiLiveVoice, type GeminiLiveVoiceHandle } from "@/lib/speech/gemini-live";
import { AiStatus, type AiUiState } from "@/components/interview/AiStatus";
import { TranscriptPanel, type TranscriptEntry } from "@/components/interview/TranscriptPanel";

type Stage = "idle" | "starting" | "live" | "left" | "error";

export default function GeminiLiveLabPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [aiState, setAiState] = useState<AiUiState>("connecting");
  const [aiDetail, setAiDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const voiceRef = useRef<GeminiLiveVoiceHandle | null>(null);

  useEffect(() => {
    return () => {
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
  }, []);

  async function handleStart() {
    setStage("starting");
    setFailure(null);
    setTranscript([]);
    setAiState("connecting");
    try {
      voiceRef.current = await startGeminiLiveVoice({
        onStatus: (state, detail) => {
          setAiState(state);
          setAiDetail(detail ?? null);
        },
        onTranscript: (role, text) => {
          setTranscript((entries) => [...entries, { role, text }]);
        },
      });
      setStage("live");
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not start the voice session.");
      setStage("error");
    }
  }

  function handleStop() {
    voiceRef.current?.stop();
    voiceRef.current = null;
    setAiState("disconnected");
    setStage("left");
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-3xl gap-6 p-6">
      <header>
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-xs text-white">I</span>
          Intervia
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Gemini Live lab</h1>
        <p className="mt-2 text-sm text-muted">
          Speak with the AI interviewer through the Gemini Live API: native voice,
          real-time turns and interruption support. Use Chrome or Edge with
          headphones for the cleanest experience.
        </p>
      </header>

      {stage === "idle" || stage === "starting" || stage === "live" ? (
        <section className="rounded-xl border border-border bg-surface p-6 leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <AiStatus state={stage === "live" ? aiState : "connecting"} detail={aiDetail} />
            {stage === "live" ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="End the voice conversation"
                className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/5"
              >
                End conversation
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={stage === "starting"}
                aria-label="Start the voice conversation"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {stage === "starting" ? "Connecting…" : "Start talking"}
              </button>
            )}
          </div>
          <div className="mt-4 min-h-64">
            <TranscriptPanel entries={transcript} interim={null} />
          </div>
        </section>
      ) : null}

      {stage === "left" ? (
        <section className="rounded-xl border border-border bg-surface p-6 text-center leading-relaxed">
          <h2 className="text-lg font-semibold">Conversation ended</h2>
          <p className="mt-1 text-sm text-muted">Start again whenever you like.</p>
          <button
            type="button"
            onClick={handleStart}
            aria-label="Start a new voice conversation"
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Start again
          </button>
        </section>
      ) : null}

      {stage === "error" ? (
        <section className="rounded-xl border border-border bg-surface p-6 text-center leading-relaxed">
          <h2 className="text-lg font-semibold">Could not start</h2>
          <p role="alert" className="mt-1 text-sm">
            {failure ?? "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={handleStart}
            aria-label="Try starting again"
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Try again
          </button>
        </section>
      ) : null}
    </main>
  );
}