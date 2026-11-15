/**
 * Background work the web app hands to its own job queue (Cloud Tasks). Each
 * job comes back to the web app as a normal request, so it runs with full CPU
 * and is retried when it fails, instead of running after a response has been
 * sent (where Cloud Run throttles it and may stop the instance).
 *
 * Pure: no I/O, so the naming and parsing can be tested directly.
 */

export type WebJob =
  | { kind: "screen-application"; roleId: string; applicationId: string }
  | { kind: "auto-invite-role"; roleId: string }
  | { kind: "score-interview"; roomId: string }
  | { kind: "mix-recording"; roomId: string };

export type WebJobKind = WebJob["kind"];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function id(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

/** The job in a request body, or null when it is not one we know. */
export function parseJob(body: unknown): WebJob | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  switch (record.kind) {
    case "screen-application": {
      const roleId = id(record.roleId);
      const applicationId = id(record.applicationId);
      return roleId && applicationId ? { kind: record.kind, roleId, applicationId } : null;
    }
    case "auto-invite-role": {
      const roleId = id(record.roleId);
      return roleId ? { kind: record.kind, roleId } : null;
    }
    case "score-interview":
    case "mix-recording": {
      const roomId = id(record.roomId);
      return roomId ? { kind: record.kind, roomId } : null;
    }
    default:
      return null;
  }
}

/** What the job is about, for its name and its log line. */
export function jobSubject(job: WebJob): string {
  switch (job.kind) {
    case "screen-application":
      return job.applicationId;
    case "auto-invite-role":
      return job.roleId;
    case "score-interview":
    case "mix-recording":
      return job.roomId;
  }
}

/**
 * Cloud Tasks task id. The queue refuses a second task with the same id, so
 * jobs for the same thing within one time window collapse into one: the
 * every-minute sweep can ask again and again without piling up duplicates.
 * Ids are kept to the characters Cloud Tasks accepts.
 */
export function jobTaskId(job: WebJob, windowMs: number, now: number): string {
  const window = Math.floor(now / Math.max(windowMs, 1));
  const raw = `${job.kind}-${jobSubject(job)}-${window}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
}

/** Default dedupe windows: a burst of identical requests becomes one job. */
export const JOB_WINDOW_MS: Record<WebJobKind, number> = {
  "screen-application": 10 * 60_000,
  "auto-invite-role": 60_000,
  "score-interview": 10 * 60_000,
  "mix-recording": 10 * 60_000,
};

export interface JobsQueueConfig {
  project: string;
  location: string;
  queue: string;
  origin: string;
  secret: string;
}

/**
 * Set when background work goes through the job queue. Unset (local
 * development, or an environment not moved yet) keeps the old in-process
 * behaviour.
 */
export function jobsQueueConfigFrom(env: Record<string, string | undefined>): JobsQueueConfig | null {
  const queue = env.TASKS_JOBS_QUEUE?.trim();
  const project = env.TASKS_PROJECT?.trim();
  const location = env.TASKS_LOCATION?.trim();
  const origin = (env.APP_BASE_URL ?? env.INTERVIA_PUBLIC_ORIGIN)?.trim();
  const secret = (env.INTERNAL_SECRET ?? env.AGENT_API_SECRET)?.trim();
  if (!queue || !project || !location || !origin || !secret) return null;
  return { project, location, queue, origin: origin.replace(/\/+$/, ""), secret };
}

/** The Cloud Tasks create request for one job. */
export function createTaskBody(config: JobsQueueConfig, job: WebJob, taskId: string) {
  return {
    task: {
      name: `projects/${config.project}/locations/${config.location}/queues/${config.queue}/tasks/${taskId}`,
      // Long enough for the slowest job (a scorecard on a long interview);
      // matches the web service's request timeout.
      dispatchDeadline: "900s",
      httpRequest: {
        httpMethod: "POST",
        url: `${config.origin}/api/internal/jobs`,
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": config.secret,
          "x-job-kind": job.kind,
        },
        body: Buffer.from(JSON.stringify(job)).toString("base64"),
      },
    },
  };
}

/** The every-minute sweep takes over the clock from the in-process timer. */
export function externalCron(env: Record<string, string | undefined>): boolean {
  return env.CRON_MODE?.trim() === "external";
}
