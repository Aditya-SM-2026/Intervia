import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import type { InterviewRoom } from "./interview.types";
import { RECONNECT_GRACE_SECONDS, reconnectStateFor } from "./reconnect.logic";

/**
 * Reconnection handling for a candidate who drops mid-interview.
 *
 * The interviewer keeps the session (question, transcript, elapsed clock)
 * alive on the server side, so a rejoin within the grace window resumes the
 * same interview from where it stopped. Past the window the interview is
 * expired: the verify gate refuses the rejoin and the watchdog closes the
 * session. All state is derived from the append-only interview event log on
 * the server — the browser never decides whether a rejoin is allowed.
 */

export { RECONNECT_GRACE_SECONDS, reconnectStateFor };
export type { ReconnectState } from "./reconnect.logic";

/**
 * Marks a room expired in the database (terminal; never overwrites a
 * completed or already-expired row) and returns the stored room.
 */
export async function expireRoom(room: InterviewRoom): Promise<InterviewRoom> {
  const repository = getInterviewRepository();
  const expired: InterviewRoom = { ...room, status: "expired" };
  await repository.save(expired);
  return expired;
}