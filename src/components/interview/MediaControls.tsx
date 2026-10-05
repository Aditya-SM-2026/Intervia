"use client";

interface MediaControlsProps {
  muted: boolean;
  cameraOff: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

export function MediaControls({
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
  onLeave,
}: MediaControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        className={`rounded-full px-4 py-2 text-sm font-medium text-white transition ${
          muted ? "bg-red-600 hover:opacity-90" : "bg-accent hover:opacity-90"
        }`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>

      <button
        type="button"
        onClick={onToggleCamera}
        aria-pressed={cameraOff}
        aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
        className={`rounded-full px-4 py-2 text-sm font-medium text-white transition ${
          cameraOff ? "bg-red-600 hover:opacity-90" : "bg-accent hover:opacity-90"
        }`}
      >
        {cameraOff ? "Camera on" : "Camera off"}
      </button>

      <button
        type="button"
        onClick={onLeave}
        aria-label="Leave the interview room"
        className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-500/20 dark:text-red-400"
      >
        Leave
      </button>
    </div>
  );
}