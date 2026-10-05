export type ConnectionStage = "connecting" | "connected" | "reconnecting";

interface ConnectionStatusProps {
  stage: ConnectionStage;
}

const STAGE_STYLES = {
  connecting: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  connected: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  reconnecting: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
} as const;

const STAGE_LABELS = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
} as const;

export function ConnectionStatus({ stage }: ConnectionStatusProps) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${STAGE_STYLES[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </p>
  );
}