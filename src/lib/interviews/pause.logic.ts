import type { InterviewEvent } from "./interview.types";

/**
 * Pure pause-window logic (no server-only import, so it is unit testable).
 *
 * An interview is paused when the candidate leaves the full screen, hides the
 * tab, or presses Leave. They may come back for PAUSE_GRACE_SECONDS; after
 * that the interview ends where it is. The window is derived only from the
 * append-only event log, so the browser can never decide it on its own.
 */

/** How long a paused candidate may take to return before the interview ends. */
export const PAUSE_GRACE_SECONDS = 2 * 60;

export interface PauseState {
  /** When the pause started (ISO 8601, from the event log). */
  pausedAt: string;
  /** Epoch milliseconds by which the candidate must be back. */
  deadline: number;
  /** They are still away past the deadline. */
  expired: boolean;
}

/**
 * The pause currently in force, if any: the last pause that has not been
 * resumed or followed by the end of the interview.
 */
export function pauseStateFor(
  events: readonly InterviewEvent[],
  now: number = Date.now(),
): PauseState | null {
  let pausedAt: string | null = null;

  for (const event of events) {
    if (event.type === "candidate_paused") pausedAt = event.at;
    else if (event.type === "candidate_resumed" || event.type === "candidate_pause_expired") {
      pausedAt = null;
    } else if (event.type === "interview_ended") pausedAt = null;
  }

  if (pausedAt === null) return null;
  const startedAt = Date.parse(pausedAt);
  if (!Number.isFinite(startedAt)) return null;

  const deadline = startedAt + PAUSE_GRACE_SECONDS * 1000;
  return { pausedAt, deadline, expired: now >= deadline };
}
