import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import { EMAIL_FAILURE_EVENT, emailLockFrom } from "./email-attempts.logic";

/**
 * Brute-force guard for the candidate email gate, per link. Failed attempts
 * are stored on the interview, so the limit holds across every web instance.
 */

/** Returns whether another verification attempt may be made right now. */
export async function checkEmailAttempt(
  roomId: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const events = await getInterviewRepository().getEvents(roomId);
  const failures = events
    .filter((event) => event.type === EMAIL_FAILURE_EVENT)
    .map((event) => Date.parse(event.at))
    .filter(Number.isFinite);
  return emailLockFrom(failures, Date.now());
}

/** Counts a failed verification; five lock the link for 15 minutes. */
export async function recordEmailFailure(roomId: string): Promise<void> {
  await getInterviewRepository().appendEvents(roomId, [
    { type: EMAIL_FAILURE_EVENT, at: new Date().toISOString(), data: {} },
  ]);
}
