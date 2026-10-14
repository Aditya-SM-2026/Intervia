import "server-only";
import {
  invitationInputFromRoom,
  sendInterviewReminder,
} from "@/lib/emails/email.service";
import { getInterviewRepository } from "@/server/repositories";

/** How often the reminder scan runs. */
const SCAN_INTERVAL_MS = 60_000;
/** The scan starts this long after boot, so the server can finish warming up. */
const START_DELAY_MS = 15_000;

/** Absolute origin used in reminder links when there is no request context. */
export function schedulerOrigin(): string {
  return (
    process.env.INTERVIA_PUBLIC_ORIGIN?.trim() ||
    `http://localhost:${process.env.PORT || 3000}`
  );
}

/**
 * One reminder pass: atomically claim every interview due for its 30-minute
 * reminder, then send one email per claimed room. Claiming first means two
 * server instances (or a retry after a crash mid-send) can never double-send.
 */
export async function runReminderScanOnce(
  transport?: Parameters<typeof sendInterviewReminder>[2],
): Promise<{ claimed: number; sent: number; failed: number }> {
  const repository = getInterviewRepository();
  const now = new Date().toISOString();
  const ids = await repository.claimDueReminders(now);
  let sent = 0;
  let failed = 0;

  for (const id of ids) {
    const room = await repository.get(id);
    if (!room?.candidateEmail || !room.scheduledAt) continue;
    const startsInMinutes = Math.max(
      1,
      Math.round((Date.parse(room.scheduledAt) - Date.now()) / 60_000),
    );
    const candidateUrl = new URL(`/interview/${room.id}`, schedulerOrigin()).toString();
    const result = await sendInterviewReminder(
      invitationInputFromRoom(room, candidateUrl),
      startsInMinutes,
      transport,
    );
    if (result.status === "sent" || result.status === "not_configured") sent++;
    else failed++;
    // A failed send stays claimed (no automatic retry): the invitation email
    // already carried the link, and the dashboard shows the room either way.
  }

  if (ids.length > 0) {
    console.info(`[reminders] scan claimed ${ids.length}, sent ${sent}, failed ${failed}`);
  }
  return { claimed: ids.length, sent, failed };
}

const globalFlags = globalThis as unknown as { __reminderSchedulerStarted?: boolean };

/** Starts the periodic reminder scan exactly once per server process. */
export function startReminderScheduler(): void {
  if (globalFlags.__reminderSchedulerStarted) return;
  globalFlags.__reminderSchedulerStarted = true;

  const timer = setInterval(() => {
    runReminderScanOnce().catch((cause) => {
      console.error("[reminders] scan error:", cause);
    });
  }, SCAN_INTERVAL_MS);
  timer.unref?.();

  setTimeout(() => {
    runReminderScanOnce().catch((cause) => {
      console.error("[reminders] initial scan error:", cause);
    });
  }, START_DELAY_MS).unref?.();

  console.info("[reminders] scheduler started (every 60s, 30 min before scheduled time)");
}