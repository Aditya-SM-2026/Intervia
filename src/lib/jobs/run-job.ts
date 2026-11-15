import "server-only";
import { scoreInterview } from "@/lib/interviews/scorecard.service";
import { buildMixedRecording } from "@/lib/recordings/mix";
import { autoInviteEnabledFor, runAutoInviteJob } from "@/lib/roles/auto-invite.service";
import { screenApplication } from "@/lib/screening/screening.service";
import { enqueueJob } from "./queue";
import type { WebJob } from "./job.logic";

/** Thrown when a job should be tried again (the queue retries with backoff). */
export class RetryableJobError extends Error {}

/**
 * Runs one job to the end. Every job is safe to run twice: screening reuses
 * an unchanged result, invitations are claimed per candidate, and a scorecard
 * or mix is simply rebuilt.
 */
export async function runJob(job: WebJob): Promise<void> {
  switch (job.kind) {
    case "screen-application": {
      const result = await screenApplication(job.roleId, job.applicationId);
      if (!result.ok) return;
      if (result.retryable) {
        throw new RetryableJobError(result.snapshot.reason || "screening call failed");
      }
      // Next step straight away: invite the candidate if they cleared the bar.
      if (result.snapshot.status === "scored" && (await autoInviteEnabledFor(job.roleId))) {
        await enqueueJob({ kind: "auto-invite-role", roleId: job.roleId });
      }
      return;
    }
    case "auto-invite-role":
      await runAutoInviteJob(job.roleId);
      return;
    case "score-interview": {
      const outcome = await scoreInterview(job.roomId);
      if (outcome.retryable) throw new RetryableJobError(outcome.reason ?? "scoring failed");
      return;
    }
    case "mix-recording":
      await buildMixedRecording(job.roomId);
      return;
  }
}
