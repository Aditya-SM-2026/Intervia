import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit/config";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { getInterviewRepository } from "@/server/repositories";
import { recordSessionOutcome } from "./interview.service";
import { reconnectStateFor } from "./reconnect.service";
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

    // Deadline first: an interview that reached its duration must always be
    // completed, never expired — even inside the grace window right after the
    // limit, where the reconnect state already reports "reached its time
    // limit". (The agent holds the room until the scheduled end, so a
    // candidate who leaves at the end lands here too.)
    const deadlinePassed = interviewDeadline(room, events) + GRACE_MS <= now;
    if (deadlinePassed) {
      closed++;
      await closeInterview(room);
      continue;
    }

    // Reconnection expiry: only a candidate who has been away for longer
    // than the 5-minute window, with duration still left (for example the
    // agent itself died mid-interview), ends as expired.
    const reconnect = reconnectStateFor(room, events);
    if (reconnect.kind === "expired") {
      closed++;
      await closeExpiredInterview(room, reconnect.reason);
      continue;
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

async function closeExpiredInterview(room: InterviewRoom, reason: string): Promise<void> {
  const repository = getInterviewRepository();
  await deleteLiveKitRoom(room.id);
  await repository.appendEvents(room.id, [
    {
      type: "interview_ended",
      at: new Date().toISOString(),
      data: { reason: "candidate_reconnect_window_exceeded", by: "web_watchdog", note: reason },
    },
  ]);
  // Expired, not completed: the interview did not finish, and the link must
  // honestly tell the candidate it is over.
  await repository.save({ ...room, status: "expired" });
}

async function closeInterview(room: InterviewRoom): Promise<void> {
  const repository = getInterviewRepository();
  const endedAt = new Date().toISOString();

  // Disconnect anyone still in the room (candidate or agent).
  await deleteLiveKitRoom(room.id);

  const turns = await repository.getTurns(room.id);
  const agentWasPresent = turns.length > 0;
  await repository.appendEvents(room.id, [
    {
      type: "interview_ended",
      at: endedAt,
      data: {
        reason: "time_up",
        by: "web_watchdog",
        note: agentWasPresent
          ? undefined
          : "The interviewer agent never joined; the session was closed at its time limit.",
      },
    },
  ]);

  if (agentWasPresent) {
    const room2 = await recordSessionOutcome(
      room.id,
      {
        reason: "time_up",
        startedAt: room.scheduledAt,
        endedAt,
        elapsedSeconds: room.durationMinutes * 60,
        coverage: [],
        usage: [],
      },
      true,
    );
    if (room2?.status === "completed") {
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