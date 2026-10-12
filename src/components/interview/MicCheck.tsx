"use client";

import { useEffect, useRef, useState } from "react";
import { createLevelMeter } from "@/lib/audio/level-meter";

/** Level above which we tell the candidate their microphone is working. */
const HEARD_THRESHOLD = 0.12;

/**
 * Microphone check for the pre-join screen: a live level bar, and a
 * confirmation once speech has actually been picked up. A silent default
 * microphone is the most common reason an interview cannot start.
 */
export function MicCheck({ track }: { track: MediaStreamTrack }) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    const meter = createLevelMeter(track);
    if (!meter) return;
    let frame = 0;
    let confirmed = false;
    const draw = () => {
      const level = Math.min(1, meter.readLevel() * 2.2);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
      if (!confirmed && level > HEARD_THRESHOLD) {
        confirmed = true;
        setHeard(true);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      meter.close();
    };
  }, [track]);

  return (
    <div className="text-left">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Microphone</span>
        <span className={heard ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}>
          {heard ? "We can hear you" : "Say a few words to test it"}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <span
          ref={fillRef}
          className="block h-full origin-left rounded-full bg-emerald-500"
          style={{ transform: "scaleX(0)" }}
        />
      </div>
    </div>
  );
}
