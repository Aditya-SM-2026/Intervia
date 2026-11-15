import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import { getRolesRepository } from "@/server/repositories/roles-repository";
import { queueAutoInviteScan } from "@/lib/roles/auto-invite.service";
import { requestVideoAnalysis } from "@/lib/interviews/scorecard.service";
import { enqueueJob } from "./queue";

/** Longer than any analysis takes (the worker's own limit is 30 minutes). */
const VIDEO_STUCK_MINUTES = 45;

/** Safety-net retries are spaced an hour apart per item. */
const RETRY_WINDOW_MS = 60 * 60_000;

/**
 * The every-minute sweep's queue work: one auto-invite job per role with the
 * automation on, and a fresh job for anything the normal path missed
 * (an application never screened, an interview finished without a report or
 * without its mixed recording).
 */
export async function queueSweepJobs(): Promise<{
  autoInviteRoles: number;
  screenings: number;
  scorecards: number;
  mixes: number;
  videos: number;
}> {
  const autoInviteRoles = await queueAutoInviteScan();

  const unscreened = await getRolesRepository().listStaleUnscreenedApplications(3, 50);
  for (const row of unscreened) {
    await enqueueJob(
      { kind: "screen-application", roleId: row.roleId, applicationId: row.id },
      { windowMs: RETRY_WINDOW_MS },
    );
  }

  const unscored = await getInterviewRepository().listUnscoredCompleted(15, 20);
  for (const roomId of unscored) {
    await enqueueJob({ kind: "score-interview", roomId }, { windowMs: RETRY_WINDOW_MS });
  }

  // Three hours of hourly retries: enough for a passing problem, without
  // re-running a broken video's mix all day.
  const unmixed = await getInterviewRepository().listUnmixedCompleted(15, 3, 20);
  for (const roomId of unmixed) {
    await enqueueJob({ kind: "mix-recording", roomId }, { windowMs: RETRY_WINDOW_MS });
  }

  // A video job lost on its way to the worker (seen when more videos were
  // queued at once than the worker had instances) would say "queued" forever.
  // Each re-send restarts the clock, so a video is tried about every 45
  // minutes, for at most six hours.
  const stuck = await getInterviewRepository().listStuckVideoAnalyses(VIDEO_STUCK_MINUTES, 6, 5);
  for (const roomId of stuck) {
    await requestVideoAnalysis(roomId, { retryStuck: true }).catch((cause) =>
      console.error(`[sweep] video re-send failed for ${roomId}:`, cause),
    );
  }

  await enqueueJob({ kind: "file-cleanup" });

  return {
    autoInviteRoles,
    screenings: unscreened.length,
    scorecards: unscored.length,
    mixes: unmixed.length,
    videos: stuck.length,
  };
}
