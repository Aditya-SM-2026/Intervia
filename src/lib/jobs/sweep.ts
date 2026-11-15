import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import { getRolesRepository } from "@/server/repositories/roles-repository";
import { queueAutoInviteScan } from "@/lib/roles/auto-invite.service";
import { enqueueJob } from "./queue";

/** Safety-net retries are spaced an hour apart per item. */
const RETRY_WINDOW_MS = 60 * 60_000;

/**
 * The every-minute sweep's queue work: one auto-invite job per role with the
 * automation on, and a fresh job for anything the normal path missed
 * (an application never screened, an interview finished without a report).
 */
export async function queueSweepJobs(): Promise<{
  autoInviteRoles: number;
  screenings: number;
  scorecards: number;
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

  return { autoInviteRoles, screenings: unscreened.length, scorecards: unscored.length };
}
