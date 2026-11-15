import "server-only";
import { scoreInterview } from "@/lib/interviews/scorecard.service";
import { findAgentAudio } from "@/lib/recordings/agent-audio";
import { recordingsBucket, uploadRecordingToGcs } from "@/lib/recordings/gcs-upload";
import { buildMixedRecording } from "@/lib/recordings/mix";
import { requestWorkerMix, workerMixEnabled } from "@/lib/recordings/mix-worker";
import { mimeFor } from "@/lib/recordings/store";
import { sweepOrphanFiles } from "@/lib/storage/cleanup";
import { getInterviewRepository } from "@/server/repositories";
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
      // A unique name: the sweep's per-minute job for this role may already
      // have run this minute, and the queue would treat this as a repeat of
      // it. Running twice is safe, each candidate is claimed once.
      if (result.snapshot.status === "scored" && (await autoInviteEnabledFor(job.roleId))) {
        await enqueueJob({ kind: "auto-invite-role", roleId: job.roleId }, { windowMs: 1 });
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
    case "mix-recording": {
      if (workerMixEnabled()) {
        const request = await requestWorkerMix(job.roomId);
        // The candidate's browser may still be sending the last piece.
        if (request.status === "waiting") throw new RetryableJobError(request.reason);
        if (request.status !== "in_process") return;
      }
      await buildMixedRecording(job.roomId);
      return;
    }
    case "upload-recording": {
      await uploadRecording(job.roomId, job.recordingId, job.format);
      return;
    }
    case "file-cleanup": {
      const result = await sweepOrphanFiles();
      if (result.removed > 0) console.info(`[cleanup] removed ${result.removed} files of deleted interviews or applications`);
      return;
    }
  }
}

/**
 * Copies a finished recording to the bucket, so it plays from anywhere and
 * the video worker can read it, then queues the mix if the interviewer's
 * audio is already in.
 */
async function uploadRecording(roomId: string, recordingId: string, format: "webm" | "mp4"): Promise<void> {
  const bucket = recordingsBucket();
  if (!bucket) return;
  const repository = getInterviewRepository();
  const objectPath = await uploadRecordingToGcs({ roomId, recordingId, format });
  if (!objectPath) throw new RetryableJobError(`GCS upload failed for ${roomId}/${recordingId}`);

  const events = await repository.getEvents(roomId);
  const recorded = events.some(
    (event) => event.type === "recording_uploaded" && event.data.path === objectPath,
  );
  if (!recorded) {
    await repository.appendEvents(roomId, [
      {
        type: "recording_uploaded",
        at: new Date().toISOString(),
        data: { storage: "gcs", bucket, path: objectPath, recordingId, mimeType: mimeFor(format) },
      },
    ]);
  }
  if (findAgentAudio(events) && !events.some((event) => event.type === "recording_mixed")) {
    await enqueueJob({ kind: "mix-recording", roomId }, { windowMs: 1 });
  }
}
