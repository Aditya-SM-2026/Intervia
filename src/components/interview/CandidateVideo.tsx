"use client";

import { useEffect, useRef } from "react";

interface CandidateVideoProps {
  /** The video track to render, or null when the camera is off. */
  track: MediaStreamTrack | null;
  /** Mirror the image (natural for a self-view). */
  mirrored?: boolean;
  label: string;
}

export function CandidateVideo({ track, mirrored = false, label }: CandidateVideoProps) {
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
      className={`relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black ${
        mirrored ? "-scale-x-100" : ""
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label={label}
        className="h-full w-full object-cover"
      />
      {!track && (
        <p className="absolute inset-0 grid place-items-center text-sm text-white/70">
          Camera is off
        </p>
      )}
    </div>
  );
}