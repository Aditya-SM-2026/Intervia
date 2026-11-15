import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_LAUNCH_EVENT,
  LAUNCH_BOOT_WINDOW_MS,
  agentJobConfigFrom,
  executionNameFrom,
  executionStatusFrom,
  lastLaunchFrom,
  runJobRequestBody,
  shouldLaunch,
} from "./agent-launch.logic.ts";

const now = Date.parse("2026-11-14T10:00:00Z");
const launchAt = (msAgo: number) => ({ execution: "projects/p/locations/r/jobs/j/executions/e1", at: new Date(now - msAgo).toISOString() });

test("job mode is off unless a job name and project are set", () => {
  assert.equal(agentJobConfigFrom({}), null);
  assert.equal(agentJobConfigFrom({ AGENT_JOB_NAME: "j" }), null);
  assert.deepEqual(agentJobConfigFrom({ AGENT_JOB_NAME: "j", TASKS_PROJECT: "p", TASKS_LOCATION: "asia-south1" }), {
    project: "p",
    region: "asia-south1",
    job: "j",
  });
  assert.deepEqual(agentJobConfigFrom({ AGENT_JOB_NAME: "j", AGENT_JOB_PROJECT: "q", AGENT_JOB_REGION: "us-central1" }), {
    project: "q",
    region: "us-central1",
    job: "j",
  });
});

test("the latest launch event wins and empty ones are skipped", () => {
  const events = [
    { type: AGENT_LAUNCH_EVENT, at: "2026-11-14T09:00:00Z", data: { execution: "old" } },
    { type: "candidate_state", at: "2026-11-14T09:01:00Z", data: {} },
    { type: AGENT_LAUNCH_EVENT, at: "2026-11-14T09:02:00Z", data: { execution: "new" } },
    { type: AGENT_LAUNCH_EVENT, at: "2026-11-14T09:03:00Z", data: { execution: "" } },
  ];
  assert.deepEqual(lastLaunchFrom(events), { execution: "new", at: "2026-11-14T09:02:00Z" });
  assert.equal(lastLaunchFrom([]), null);
});

test("a running interviewer is reused, a finished one is replaced", () => {
  assert.equal(shouldLaunch(null, "unknown", now), true);
  assert.equal(shouldLaunch(launchAt(60 * 60 * 1000), "running", now), false);
  assert.equal(shouldLaunch(launchAt(1000), "finished", now), true);
});

test("an unreadable execution is trusted only while it may still be booting", () => {
  assert.equal(shouldLaunch(launchAt(30_000), "unknown", now), false);
  assert.equal(shouldLaunch(launchAt(LAUNCH_BOOT_WINDOW_MS + 1), "unknown", now), true);
});

test("execution status comes from its completion time", () => {
  assert.equal(executionStatusFrom({ name: "x" }), "running");
  assert.equal(executionStatusFrom({ completionTime: "2026-11-14T10:00:00Z" }), "finished");
  assert.equal(executionStatusFrom(null), "unknown");
});

test("the run request carries the interview and room, and the execution name is read back", () => {
  const body = runJobRequestBody("abc", "predev-interview-abc");
  assert.deepEqual(body.overrides.containerOverrides[0].env, [
    { name: "INTERVIA_INTERVIEW_ID", value: "abc" },
    { name: "INTERVIA_ROOM_NAME", value: "predev-interview-abc" },
  ]);
  assert.equal(
    executionNameFrom({ metadata: { name: "projects/p/locations/r/jobs/j/executions/j-x1" } }),
    "projects/p/locations/r/jobs/j/executions/j-x1",
  );
  assert.equal(executionNameFrom({ metadata: {} }), null);
});
