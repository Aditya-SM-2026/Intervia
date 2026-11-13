import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit/config";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { getInterviewRepository } from "@/server/repositories";
import { recordSessionOutcome } from "./interview.service";
import { pauseStateFor } from "./pause.logic";
import { scoreInterview } from "./scorecard.service";
import type { InterviewRoom } from "./interview.types";

/**
 * Server-side time enforcement.
 *
 * The interviewer agent normally ends an interview when its time budget runs
 * out (it closes the LiveKit room, which ends the candidate's session and
 * finalises the recording). When the agent never joins — it is a separate
 * deployment and can be down — nothing else stops the clock: the interview
 * stays "active" forever, the report stays "processing" forever, and the
 * candidate keeps recording.
 *
 * This watchdog runs every minute alongside the reminder scan. Any interview
 * whose scheduled end has passed by more than the grace period is closed:
 * the LiveKit room is deleted, an interview_ended event is logged, and the
 * session is completed (when the agent produced turns) or expired (when it
 * did not). Already-ended interviews are never touched.
 */

/** Grace after the time limit before the watchdog steps in. */
const GRACE_MS = 90_000;

export async function runInterviewWatchdogOnce(): Promise<number> {
  const repository = getInterviewRepository();
  const rooms = await repository.list({ status: ["active", "waiting"] });
  const now = Date.now();
  let closed = 0;

  for (const room of rooms) {
    const events = await repository.getEvents(room.id);
    if (events.some((event) => event.type === "interview_ended")) continue;

    // Only close rooms where the interview actually began. A room the
    // candidate never joined is governed by the link's 24-hour expiry, not
    // by the duration clock. "Expired" means exactly one thing: the link's
    // 24 hours passed with the candidate never joining — nothing else.
    if (!events.some((event) => event.type === "interview_started")) continue;

    const deadlinePassed = interviewDeadline(room, events) + GRACE_MS <= now;
    if (deadlinePassed) {
      closed++;
      await closeInterview(room, "time_up");
      continue;
    }

    // A candidate who left the full screen and never came back ends the
    // interview too. The agent normally does this at the two-minute mark; this
    // is the backstop for when the agent is down or never reached.
    const pause = pauseStateFor(events, now);
    if (pause?.expired) {
      closed++;
      await closeInterview(room, "pause_timeout");
    }
  }
  if (closed > 0) console.info(`[watchdog] closed ${closed} overdue interview(s)`);
  return closed;
}

/**
 * When the interview must end: its actual start plus duration. The scheduled
 * time is only a fallback — a recruiter often schedules an interview days
 * ahead and the candidate joins early, so the clock that matters is the one
 * that starts when the session really begins (the first logged event).
 */
function interviewDeadline(room: InterviewRoom, events: readonly { at: string }[]): number {
  const firstEvent = events[0]?.at;
  const start = Date.parse(firstEvent ?? room.scheduledAt ?? room.createdAt);
  return (Number.isFinite(start) ? start : Date.now()) + room.durationMinutes * 60_000;
}

/**
 * Closes an interview that ran out of time, was left paused past its window,
 * or was ended by the candidate. Exported so the presence endpoint can do it
 * the moment it happens instead of waiting for the minute-by-minute sweep.
 */
export async function closeInterview(
  room: InterviewRoom,
  reason: "time_up" | "pause_timeout" | "candidate_exited",
): Promise<void> {
  const repository = getInterviewRepository();
  const endedAt = new Date().toISOString();
  const events = await repository.getEvents(room.id);

  // Disconnect anyone still in the room (candidate or agent).
  await deleteLiveKitRoom(room.id);

  const turns = await repository.getTurns(room.id);
  const agentWasPresent = turns.length > 0;
  // How long the session really ran, from the first logged event: a pause
  // timeout happens minutes before the booked duration is over.
  const startEvent = events.find((event) => event.type === "interview_started") ?? events[0];
  const startedAt = startEvent?.at ?? room.scheduledAt ?? room.createdAt;
  const ranForSeconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  await repository.appendEvents(room.id, [
    {
      type: "interview_ended",
      at: endedAt,
      data: {
        reason,
        by: "web_watchdog",
        note: agentWasPresent
          ? undefined
          : reason === "pause_timeout"
            ? "The candidate left the full screen and did not return; no interviewer was present to close the session."
            : reason === "candidate_exited"
              ? "The candidate ended the interview; no interviewer was present to close the session."
              : "The interviewer agent never joined; the session was closed at its time limit.",
      },
    },
  ]);

  if (agentWasPresent || reason === "candidate_exited") {
    // The agent's own outcome, when it got there first, is richer (coverage,
    // usage, real elapsed time): keep it rather than replacing it with blanks.
    const outcome = room.outcome ?? {
      reason,
      startedAt: room.scheduledAt,
      endedAt,
      elapsedSeconds: Number.isFinite(ranForSeconds) && ranForSeconds > 0
        ? ranForSeconds
        : room.durationMinutes * 60,
      coverage: [],
      usage: [],
    };
    const room2 = await recordSessionOutcome(room.id, outcome, true);
    if (agentWasPresent && room2?.status === "completed") {
      // Scoring runs in the background, exactly as the agent path does.
      void scoreInterview(room.id).catch((error) => {
        console.error(`[watchdog] scoring failed for ${room.id}:`, error);
      });
    }
  } else {
    // No interviewer ever joined: there is no conversation to score. The link
    // stays honestly "expired" instead of "processing" forever.
    await repository.save({ ...room, status: "expired" });
  }
}

async function deleteLiveKitRoom(roomId: string): Promise<void> {
  if (!isLiveKitConfigured()) return;
  try {
    const config = getLiveKitConfig();
    // The ws URL is accepted as-is by RoomServiceClient.
    const client = new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
    await client.deleteRoom(getLiveKitRoomName(roomId));
  } catch (error) {
    // A room that is already gone is fine; anything else still ends the
    // session in the database below.
    console.error(
      `[watchdog] could not delete LiveKit room for ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}