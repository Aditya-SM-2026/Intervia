import "server-only";
import { metadataToken } from "@/lib/queue/cloud-tasks";
import { getInterviewRepository } from "@/server/repositories";
import {
  AGENT_LAUNCH_EVENT,
  agentJobConfigFrom,
  executionNameFrom,
  executionStatusFrom,
  lastLaunchFrom,
  runJobRequestBody,
  shouldLaunch,
  type AgentJobConfig,
  type ExecutionStatus,
} from "./agent-launch.logic";

const RUN_API = "https://run.googleapis.com/v2";

export function agentJobConfig(): AgentJobConfig | null {
  return agentJobConfigFrom(process.env);
}

// Two email-gate requests for the same interview at once (a double click)
// would otherwise both see "no job yet" and start two.
const inflight = new Map<string, Promise<void>>();

async function executionStatus(token: string, execution: string): Promise<ExecutionStatus> {
  try {
    const response = await fetch(`${RUN_API}/${execution}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return "finished";
    if (!response.ok) return "unknown";
    return executionStatusFrom(await response.json());
  } catch {
    return "unknown";
  }
}

async function launch(config: AgentJobConfig, roomId: string, roomName: string): Promise<void> {
  const token = await metadataToken();
  if (!token) throw new Error("No Google access token to start the interviewer job.");

  const repository = getInterviewRepository();
  const last = lastLaunchFrom(await repository.getEvents(roomId));
  const status = last ? await executionStatus(token, last.execution) : "unknown";
  if (!shouldLaunch(last, status, Date.now())) return;

  const url = `${RUN_API}/projects/${config.project}/locations/${config.region}/jobs/${config.job}:run`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(runJobRequestBody(roomId, roomName)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Starting the interviewer job failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const execution = executionNameFrom(await response.json());
  await repository.appendEvents(roomId, [
    {
      type: AGENT_LAUNCH_EVENT,
      at: new Date().toISOString(),
      data: { execution: execution ?? "", job: config.job },
    },
  ]);
}

/**
 * Starts this interview's own interviewer machine (a Cloud Run job execution)
 * unless one is already running for it. Called at the email gate, so the
 * machine boots while the candidate checks their camera and microphone.
 */
export async function ensureInterviewAgent(
  config: AgentJobConfig,
  roomId: string,
  roomName: string,
): Promise<void> {
  const pending = inflight.get(roomId);
  if (pending) return pending;
  const task = launch(config, roomId, roomName).finally(() => inflight.delete(roomId));
  inflight.set(roomId, task);
  return task;
}
