import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import { pauseStateFor } from "./pause.logic";
import { closeInterview } from "./watchdog.service";

export type CloseEarlyResult = "closed" | "already_ended" | "not_paused" | "unavailable";

/**
 * Ends an interview before its time, on the candidate's own word: they left
 * full screen and never came back, or they pressed Leave.
 *
 * The interviewer agent normally closes the session itself (and writes the
 * richer outcome: coverage, usage, real elapsed time). This path exists for
 * when no agent is in the room, or it is not responding: the candidate is
 * gone, so the session must still close rather than record forever.
 */
export async function closeInterviewEarly(
  roomId: string,
  reason: "pause_timeout" | "candidate_exited",
): Promise<CloseEarlyResult> {
  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room || (room.status !== "active" && room.status !== "waiting")) return "unavailable";

  const events = await repository.getEvents(roomId);
  if (events.some((event) => event.type === "interview_ended")) return "already_ended";
  // A pause timeout only makes sense while there is a pause to time out.
  if (reason === "pause_timeout" && !pauseStateFor(events)) return "not_paused";

  await closeInterview(room, reason);
  return "closed";
}
