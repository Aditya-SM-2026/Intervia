import "server-only";
import { metadataToken } from "@/lib/queue/cloud-tasks";
import {
  JOB_WINDOW_MS,
  createTaskBody,
  jobSubject,
  jobTaskId,
  jobsQueueConfigFrom,
  type WebJob,
} from "./job.logic";

export type { WebJob } from "./job.logic";

/** Whether background work goes through the job queue in this deployment. */
export function jobsQueueEnabled(): boolean {
  return jobsQueueConfigFrom(process.env) !== null;
}

/** The old behaviour: run the job in this process without waiting for it. */
function runInProcess(job: WebJob): void {
  void import("./run-job")
    .then(({ runJob }) => runJob(job))
    .catch((error: unknown) => {
      console.warn(
        `[jobs] ${job.kind} ${jobSubject(job)} failed in-process: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
}

/**
 * Hands one job to the queue. Returns once the queue has it (or already had
 * the same job in this window). When there is no queue, or the queue cannot
 * be reached, the job runs in this process instead, as before the queue.
 */
export async function enqueueJob(job: WebJob, options: { windowMs?: number } = {}): Promise<void> {
  const config = jobsQueueConfigFrom(process.env);
  if (!config) {
    runInProcess(job);
    return;
  }
  const taskId = jobTaskId(job, options.windowMs ?? JOB_WINDOW_MS[job.kind], Date.now());
  try {
    const token = await metadataToken();
    if (!token) throw new Error("no Google access token");
    const response = await fetch(
      `https://cloudtasks.googleapis.com/v2/projects/${config.project}/locations/${config.location}/queues/${config.queue}/tasks`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(createTaskBody(config, job, taskId)),
        signal: AbortSignal.timeout(10_000),
      },
    );
    // 409: the same job is already queued in this window.
    if (response.ok || response.status === 409) return;
    throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  } catch (error) {
    console.warn(
      `[jobs] could not queue ${job.kind} ${jobSubject(job)}, running it here: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    runInProcess(job);
  }
}
