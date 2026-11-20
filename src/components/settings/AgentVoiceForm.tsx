"use client";

import { InfoTip } from "@/components/ui/InfoTip";

import { useEffect, useRef, useState } from "react";
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
      setSaved("Voice settings saved. Every new interview from now on uses them.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">Agent voice<InfoTip text={`How the interviewer sounds during the call. Play a sample ("${VOICE_SAMPLE_TEXT}") to hear it, then pick the voice you want. The chosen voice is used for every interview from now on.`} /></h2>
          </div>
        </div>

        {/* Five voices: one list, so none sits alone in a half-empty row. */}
        <div className="mt-5 grid gap-2">
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
                      <span className="flex items-center gap-1.5 font-semibold tracking-tight">
                        {option.name}
                        <InfoTip text={option.description} />
                      </span>
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

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur">
        {saved ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{saved}</span>
          </span>
        ) : (
          <span className="text-sm text-muted">Applies to every interview from now on</span>
        )}
        <span className="grow" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-60"
        >
          {saving ? <Sparkles className="size-4 animate-pulse" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
