export type AiUiState =
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "error"
  | "disconnected";

interface AiStatusProps {
  state: AiUiState;
  detail?: string | null;
}

const STATE_STYLES = {
  connecting: "border-border bg-surface text-muted",
  listening: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  processing: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  speaking: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  error: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  disconnected: "border-border bg-surface text-muted",
} as const;

const STATE_LABELS = {
  connecting: "AI interviewer: connecting…",
  listening: "AI interviewer: listening",
  processing: "AI interviewer: thinking…",
  speaking: "AI interviewer: speaking",
  error: "AI interviewer: problem",
  disconnected: "AI interviewer: disconnected",
} as const;

export function AiStatus({ state, detail }: AiStatusProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-1 text-center"
    >
      <span
        className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${STATE_STYLES[state]}`}
      >
        {STATE_LABELS[state]}
      </span>
      {state === "error" && detail && (
        <span className="max-w-sm text-xs text-muted">{detail}</span>
      )}
    </div>
  );
}