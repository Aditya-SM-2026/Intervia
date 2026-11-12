"use client";

import { useEffect, useRef } from "react";

interface CandidateVideoProps {
  /** The video track to render, or null when the camera is off. */
  track: MediaStreamTrack | null;
  /** Mirror the image (natural for a self-view). */
  mirrored?: boolean;
  label: string;
  /** Fill the parent's height instead of keeping a 16:9 box. */
  fill?: boolean;
}

export function CandidateVideo({ track, mirrored = false, label, fill = false }: CandidateVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (track) {
      video.srcObject = new MediaStream([track]);
      video.play().catch(() => {
        // Autoplay can be blocked until the user interacts; they already
        // clicked to join, so this is only a safety net.
      });
    } else {
      video.srcObject = null;
    }

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl bg-[#0f1b45] ${
        fill ? "h-full" : "aspect-video border border-white/10 shadow-lg shadow-black/30"
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label={label}
        className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
      />
      {!track && (
        <p className="absolute inset-0 grid place-items-center text-xs text-white/60">
          Camera is off
        </p>
      )}
    </div>
  );
}