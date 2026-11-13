import type { InterviewEvent } from "./interview.types";

/**
 * Pure pause-window logic (no server-only import, so it is unit testable).
 *
 * An interview is paused when the candidate leaves the full screen or hides
 * the tab. They may be away for PAUSE_GRACE_SECONDS in total, across the whole
 * interview: coming back and leaving again continues the same countdown
 * rather than starting a fresh one. Past the budget the interview ends where
 * it is. The window is derived only from the append-only event log, so the
 * browser can never decide it on its own.
 */

/** How long a candidate may be away in total, for the whole interview. */
export const PAUSE_GRACE_SECONDS = 30;
const PAUSE_BUDGET_MS = PAUSE_GRACE_SECONDS * 1000;

export interface PauseState {
  /** When the pause started (ISO 8601, from the event log). */
  pausedAt: string;
  /** Epoch milliseconds by which the candidate must be back. */
  deadline: number;
  /** They are still away past the deadline. */
  expired: boolean;
}

export interface PauseBudget {
  /** Seconds already spent away, including the pause in progress. */
  usedSeconds: number;
  /** Seconds of the budget the candidate still has. */
  remainingSeconds: number;
  /** The pause currently in force, if any. */
  pause: PauseState | null;
}

/**
 * The pause budget and the pause in force, from the event log. The budget is
 * spent, never reset: each new pause may only run for what is left.
 */
export function pauseBudgetFor(
  events: readonly InterviewEvent[],
  now: number = Date.now(),
): PauseBudget {
  let usedMs = 0;
  let openAt: number | null = null;
  let openDeadline = 0;

  for (const event of events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;

    if (event.type === "candidate_paused") {
      if (openAt === null) {
        openAt = at;
        // Only what is left of the budget is allowed this time.
        openDeadline = at + Math.max(0, PAUSE_BUDGET_MS - usedMs);
      }
    } else if (event.type === "candidate_resumed" || event.type === "candidate_pause_expired") {
      if (openAt !== null) {
        usedMs += Math.max(0, at - openAt);
        openAt = null;
      }
    } else if (event.type === "interview_ended") {
      if (openAt !== null) {
        usedMs += Math.max(0, at - openAt);
        openAt = null;
      }
    }
  }

  let usedNow = usedMs;
  let pause: PauseState | null = null;
  if (openAt !== null) {
    const allowed = Math.max(0, PAUSE_BUDGET_MS - usedMs);
    const away = Math.max(0, now - openAt);
    usedNow = usedMs + Math.min(away, allowed);
    pause = {
      pausedAt: new Date(openAt).toISOString(),
      deadline: openDeadline,
      expired: now >= openDeadline,
    };
  }

  const usedSeconds = Math.round(usedNow / 1000);
  return {
    usedSeconds,
    remainingSeconds: Math.max(0, PAUSE_GRACE_SECONDS - usedSeconds),
    pause,
  };
}

/** The pause currently in force, if any. */
export function pauseStateFor(
  events: readonly InterviewEvent[],
  now: number = Date.now(),
): PauseState | null {
  return pauseBudgetFor(events, now).pause;
}
