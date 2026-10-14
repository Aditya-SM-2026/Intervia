import "server-only";
import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/livekit/config";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { getInterviewRepository } from "@/server/repositories";
import { recordSessionOutcome } from "./interview.service";
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

/** Grace after the scheduled end before the watchdog steps in. */
const GRACE_MS = 5 * 60_000;

export async function runInterviewWatchdogOnce(): Promise<number> {
  const repository = getInterviewRepository();
  const rooms = await repository.list({ status: ["active", "waiting"] });
  const now = Date.now();
  let closed = 0;

  for (const room of rooms) {
    if (interviewDeadline(room) + GRACE_MS > now) continue;
    if (await hasEndedEvent(room.id)) continue;
    closed++;
    await closeInterview(room);
  }
  if (closed > 0) console.info(`[watchdog] closed ${closed} overdue interview(s)`);
  return closed;
}

/** When the interview must end: its start (scheduled or created) plus duration. */
function interviewDeadline(room: InterviewRoom): number {
  const start = Date.parse(room.scheduledAt ?? room.createdAt);
  return (Number.isFinite(start) ? start : Date.now()) + room.durationMinutes * 60_000;
}

async function hasEndedEvent(roomId: string): Promise<boolean> {
  const events = await getInterviewRepository().getEvents(roomId);
  return events.some((event) => event.type === "interview_ended");
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