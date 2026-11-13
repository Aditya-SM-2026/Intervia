import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import { pauseStateFor } from "./pause.logic";
import { closeInterview } from "./watchdog.service";

export type PauseCloseResult = "closed" | "already_ended" | "not_paused" | "unavailable";

/**
 * Ends an interview whose candidate left the full screen and did not come
 * back inside the pause window.
 *
 * The interviewer agent normally does this itself two minutes after the
 * pause, and writes the richer outcome (coverage, usage, real elapsed time).
 * This path exists for when no agent is in the room, or it is not responding:
 * the candidate never returns, so the session must still close rather than
 * record forever.
 */
export async function endPausedInterview(roomId: string): Promise<PauseCloseResult> {
  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room || (room.status !== "active" && room.status !== "waiting")) return "unavailable";

  const events = await repository.getEvents(roomId);
  if (events.some((event) => event.type === "interview_ended")) return "already_ended";
  if (!pauseStateFor(events)) return "not_paused";

  await closeInterview(room, "pause_timeout");
  return "closed";
}
