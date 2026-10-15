import type { InterviewEvent, InterviewRoom } from "./interview.types";

/**
 * Pure reconnection-window logic (no server-only import, so it is unit
 * testable): who may resume an interview after a mid-interview disconnect,
 * and when it is expired, decided purely from the append-only event log.
 */

/** How long a disconnected candidate may rejoin and resume. */
export const RECONNECT_GRACE_SECONDS = 5 * 60;

export type ReconnectState =
  /** The interview has not started; the full duration lies ahead. */
  | { kind: "fresh" }
  /** Started; the candidate may join or rejoin and has this much time left. */
  | { kind: "active"; remainingSeconds: number }
  /** Past the duration limit or the reconnection window. */
  | { kind: "expired"; reason: string };

export function reconnectStateFor(
  room: InterviewRoom,
  events: readonly InterviewEvent[],
  now: number = Date.now(),
): ReconnectState {
  const durationSeconds = room.durationMinutes * 60;

  // The authoritative start is the agent's interview_started event; the first
  // event of any kind is the fallback (agent_joined and similar log first).
  const startEvent = events.find((event) => event.type === "interview_started") ?? events[0];
  if (!startEvent) return { kind: "fresh" };
  const startedAt = Date.parse(startEvent.at);
  if (!Number.isFinite(startedAt)) return { kind: "fresh" };

  const deadline = startedAt + durationSeconds * 1000;
  if (now >= deadline) {
    return { kind: "expired", reason: "This interview has reached its time limit." };
  }

  // When the candidate is currently away, the reconnection clock is running.
  // candidate_disconnected / candidate_reconnected are logged by the
  // interviewer whenever the candidate's LiveKit participant leaves/returns.
  const lastReconnect = events
    .filter((event) => event.type === "candidate_reconnected")
    .reduce((latest, event) => Math.max(latest, Date.parse(event.at) || 0), startedAt);
  const lastDisconnect = events
    .filter((event) => event.type === "candidate_disconnected")
    .reduce((latest, event) => Math.max(latest, Date.parse(event.at) || 0), 0);

  if (lastDisconnect > lastReconnect) {
    const awayForSeconds = Math.floor((now - lastDisconnect) / 1000);
    if (awayForSeconds > RECONNECT_GRACE_SECONDS) {
      return {
        kind: "expired",
        reason:
          "This interview expired because the connection was lost for more than 5 minutes.",
      };
    }
  }

  return {
    kind: "active",
    remainingSeconds: Math.ceil((deadline - now) / 1000),
  };
}