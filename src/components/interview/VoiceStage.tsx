"use client";

import { useEffect, useRef } from "react";
import { createLevelMeter } from "@/lib/audio/level-meter";
import type { AiUiState } from "./AiStatus";

interface VoiceStageProps {
  state: AiUiState;
  /** Shown instead of the status line when something needs the candidate's attention. */
  detail: string | null;
  /** The interviewer's voice, as received. */
  interviewerTrack: MediaStreamTrack | null;
  /** The candidate's microphone. */
  microphoneTrack: MediaStreamTrack | null;
  muted: boolean;
}

const BAR_COUNT = 44;
const FLOOR = 0.05;

const STATUS: Record<AiUiState, string> = {
  connecting: "Connecting you to the interviewer…",
  listening: "Listening to you",
  processing: "Thinking",
  speaking: "Interviewer is speaking",
  error: "The interviewer is not responding",
  disconnected: "The interviewer has left",
};

/**
 * The centre of the interview room: one line of bars that shows whoever is
 * talking. It moves with the interviewer's actual voice while they speak and
 * with the candidate's microphone while they answer, so the candidate can see
 * at a glance that they are being heard.
 */
export function VoiceStage({
  state,
  detail,
  interviewerTrack,
  microphoneTrack,
  muted,
}: VoiceStageProps) {
  const barsRef = useRef<HTMLDivElement>(null);
  // Read inside the animation loop without restarting it on every change.
  const liveRef = useRef({ state, muted });
  useEffect(() => {
    liveRef.current = { state, muted };
  }, [state, muted]);

  useEffect(() => {
    const container = barsRef.current;
    if (!container) return;
    const bars = [...container.children] as HTMLElement[];
    const interviewer = interviewerTrack ? createLevelMeter(interviewerTrack) : null;
    const microphone = microphoneTrack ? createLevelMeter(microphoneTrack) : null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const target = new Float32Array(BAR_COUNT);
    const shown = new Float32Array(BAR_COUNT).fill(FLOOR);
    let frame = 0;

    const draw = (time: number) => {
      const { state: current, muted: isMuted } = liveRef.current;
      if (current === "speaking" && interviewer) {
        interviewer.readBands(target);
      } else if (current === "processing") {
        // A slow travelling ripple: clearly "working", clearly not speech.
        for (let index = 0; index < BAR_COUNT; index += 1) {
          target[index] = 0.14 + 0.1 * Math.sin(time / 260 - index * 0.42);
        }
      } else if (current === "listening" && microphone && !isMuted) {
        microphone.readBands(target);
      } else {
        target.fill(0);
      }

      for (let index = 0; index < BAR_COUNT; index += 1) {
        // The loudest bands sit in the middle of the line.
        const centred = Math.abs(index - (BAR_COUNT - 1) / 2) / (BAR_COUNT / 2);
        const band = Math.min(BAR_COUNT - 1, Math.floor(centred * BAR_COUNT));
        const next = Math.max(FLOOR, Math.min(1, target[band] * 1.5));
        shown[index] += (next - shown[index]) * (reduceMotion ? 1 : 0.4);
        bars[index].style.transform = `scaleY(${shown[index].toFixed(3)})`;
      }
      frame = requestAnimationFrame(draw);
    };

    if (reduceMotion) {
      // No continuous motion: the colour and the status line carry the state.
      bars.forEach((bar) => {
        bar.style.transform = "scaleY(0.3)";
      });
    } else {
      frame = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(frame);
      interviewer?.close();
      microphone?.close();
    };
  }, [interviewerTrack, microphoneTrack]);

  const voice =
    state === "speaking"
      ? "interviewer"
      : state === "listening" && !muted
        ? "candidate"
        : state === "error" || state === "disconnected"
          ? "problem"
          : "idle";

  return (
    <div className="flex flex-col items-center gap-5" role="group" aria-label="Interview audio">
      <div ref={barsRef} data-voice={voice} className="voice-line" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {state === "error" && detail
          ? detail
          : muted && state === "listening"
            ? "You are muted. Unmute to answer."
            : STATUS[state]}
      </p>
    </div>
  );
}
