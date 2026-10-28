"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Play, Save, Sparkles, Square } from "lucide-react";
import {
  AGENT_VOICES,
  DEFAULT_AGENT_VOICE_ID,
  VOICE_SAMPLE_TEXT,
  type AgentVoiceId,
} from "@/lib/agent/agent-voices";
import type { AgentPersonality } from "@/lib/agent/personality.types";

/** The voice picker: five options, each with a playable sample. */
export function AgentVoiceForm({ initial }: { initial: AgentPersonality }) {
  const [voice, setVoice] = useState<AgentVoiceId>(
    (initial.voice as AgentVoiceId | "") || DEFAULT_AGENT_VOICE_ID,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState<AgentVoiceId | null>(null);
  const [loadingSample, setLoadingSample] = useState<AgentVoiceId | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  function stopSample() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewing(null);
  }

  // Leaving the page must not leave a sample playing.
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function playSample(id: AgentVoiceId) {
    setPreviewError(null);
    if (previewing === id || loadingSample === id) {
      stopSample();
      setLoadingSample(null);
      return;
    }
    stopSample();
    setLoadingSample(id);
    try {
      const response = await fetch(`/api/settings/agent/voice-preview?voice=${id}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not play the sample.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stopSample();
      setPreviewing(id);
      await audio.play();
    } catch (cause) {
      stopSample();
      setPreviewError((cause as Error).message);
    } finally {
      setLoadingSample(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      // Only the voice is sent: the behaviour page owns the instructions.
      const response = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Could not save the voice.");
      }
      setSaved("Voice saved. Every interview from now on uses it.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selected = AGENT_VOICES.find((option) => option.id === voice) ?? AGENT_VOICES[2];

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Agent voice</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              How the interviewer sounds during the call. Play a sample to hear it, then pick the
              voice you want. The chosen voice is used for every interview from now on.
            </p>
            <p className="mt-1 text-xs text-muted">Sample: &ldquo;{VOICE_SAMPLE_TEXT}&rdquo;</p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
            {selected.name} · {selected.tone}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {AGENT_VOICES.map((option) => {
            const isSelected = voice === option.id;
            const isPlaying = previewing === option.id;
            const isLoading = loadingSample === option.id;
            return (
              <div
                key={option.id}
                className={`rounded-xl border p-4 transition ${
                  isSelected ? "border-accent bg-accent-soft" : "border-border hover:border-accent/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="agent-voice"
                      value={option.id}
                      checked={isSelected}
                      onChange={() => {
                        setVoice(option.id);
                        setSaved(null);
                      }}
                      style={{ accentColor: "var(--accent)" }}
                      className="mt-1 size-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold tracking-tight">{option.name}</span>
                      <span className="block text-xs text-muted">
                        {option.tone} · {option.gender === "female" ? "Female" : "Male"}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void playSample(option.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-background"
                  >
                    {isLoading ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : isPlaying ? (
                      <Square className="size-3.5" aria-hidden />
                    ) : (
                      <Play className="size-3.5" aria-hidden />
                    )}
                    {isLoading ? "Loading" : isPlaying ? "Stop" : "Play sample"}
                  </button>
                </div>
                <p className="mt-3 text-xs text-muted">{option.description}</p>
              </div>
            );
          })}
        </div>

        {previewError && (
          <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {previewError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? (
            <Sparkles className="size-4 animate-pulse" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {saving ? "Saving…" : "Save voice"}
        </button>
        <Link
          href="/dashboard/settings"
          className="ml-auto text-sm font-medium text-muted transition hover:text-foreground"
        >
          Back to settings
        </Link>
      </div>

      {saved && (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" aria-hidden />
          {saved}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
