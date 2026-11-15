/**
 * Pure decisions for starting the interviewer as its own Cloud Run job, one
 * execution per interview. Kept free of I/O so it can be tested directly.
 */

/** Event written each time the web app starts an interviewer job. */
export const AGENT_LAUNCH_EVENT = "agent_launch_requested";

/**
 * While a job is still booting, its execution may not be readable yet. A
 * launch this recent is trusted to be on its way rather than started twice.
 */
export const LAUNCH_BOOT_WINDOW_MS = 3 * 60 * 1000;

export interface AgentJobConfig {
  project: string;
  region: string;
  job: string;
}

export interface LaunchEventLike {
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface LastLaunch {
  execution: string;
  at: string;
}

/**
 * Set when the interviewer runs as a Cloud Run job per interview. Unset keeps
 * the long-running worker and dispatch-by-token, unchanged.
 */
export function agentJobConfigFrom(env: Record<string, string | undefined>): AgentJobConfig | null {
  const job = env.AGENT_JOB_NAME?.trim();
  if (!job) return null;
  const project = (env.AGENT_JOB_PROJECT ?? env.TASKS_PROJECT)?.trim();
  const region = (env.AGENT_JOB_REGION ?? env.TASKS_LOCATION)?.trim() || "asia-south1";
  if (!project) return null;
  return { project, region, job };
}

/** The most recent interviewer job started for this interview, if any. */
export function lastLaunchFrom(events: readonly LaunchEventLike[]): LastLaunch | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== AGENT_LAUNCH_EVENT) continue;
    const execution = event.data.execution;
    if (typeof execution === "string" && execution) return { execution, at: event.at };
  }
  return null;
}

/** What the Cloud Run API said about the last execution. */
export type ExecutionStatus = "running" | "finished" | "unknown";

/**
 * Whether a new interviewer job is needed. A candidate who reloads the page
 * passes the email gate again; starting a second job would put two
 * interviewers in one room, so a running (or still booting) one is reused.
 */
export function shouldLaunch(
  last: LastLaunch | null,
  status: ExecutionStatus,
  now: number,
): boolean {
  if (!last) return true;
  if (status === "running") return false;
  if (status === "finished") return true;
  const age = now - Date.parse(last.at);
  return !(age >= 0 && age < LAUNCH_BOOT_WINDOW_MS);
}

/** Cloud Run v2 execution resource: finished once it has a completion time. */
export function executionStatusFrom(body: unknown): ExecutionStatus {
  if (!body || typeof body !== "object") return "unknown";
  const record = body as Record<string, unknown>;
  if (typeof record.completionTime === "string" && record.completionTime) return "finished";
  return "running";
}

export function runJobRequestBody(interviewId: string, roomName: string) {
  return {
    overrides: {
      containerOverrides: [
        {
          env: [
            { name: "INTERVIA_INTERVIEW_ID", value: interviewId },
            { name: "INTERVIA_ROOM_NAME", value: roomName },
          ],
        },
      ],
    },
  };
}

/** The execution name from the long-running operation `jobs.run` returns. */
export function executionNameFrom(operation: unknown): string | null {
  if (!operation || typeof operation !== "object") return null;
  const metadata = (operation as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const name = (metadata as Record<string, unknown>).name;
  return typeof name === "string" && name.includes("/executions/") ? name : null;
}
