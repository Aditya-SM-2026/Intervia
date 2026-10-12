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
        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
          muted
            ? "border-red-500 bg-red-600 text-white hover:opacity-90"
            : "border-border hover:bg-surface"
        }`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>

      <button
        type="button"
        onClick={onToggleCamera}
        aria-pressed={cameraOff}
        aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
          cameraOff
            ? "border-red-500 bg-red-600 text-white hover:opacity-90"
            : "border-border hover:bg-surface"
        }`}
      >
        {cameraOff ? "Turn camera on" : "Turn camera off"}
      </button>

      <button
        type="button"
        onClick={onLeave}
        aria-label="Leave the interview room"
        className="rounded-full border border-red-500/50 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/25"
      >
        Leave interview
      </button>
    </div>
  );
}