import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JOB_WINDOW_MS,
  createTaskBody,
  externalCron,
  jobTaskId,
  jobsQueueConfigFrom,
  parseJob,
} from "./job.logic.ts";

const env = {
  TASKS_JOBS_QUEUE: "jobs",
  TASKS_PROJECT: "p",
  TASKS_LOCATION: "asia-south1",
  APP_BASE_URL: "https://web.example/",
  INTERNAL_SECRET: "s3cret",
};

test("the job queue is off unless every setting is present", () => {
  assert.equal(jobsQueueConfigFrom({}), null);
  assert.equal(jobsQueueConfigFrom({ ...env, TASKS_JOBS_QUEUE: "" }), null);
  assert.equal(jobsQueueConfigFrom({ ...env, INTERNAL_SECRET: undefined }), null);
  assert.deepEqual(jobsQueueConfigFrom(env), {
    project: "p",
    location: "asia-south1",
    queue: "jobs",
    origin: "https://web.example",
    secret: "s3cret",
  });
  assert.equal(
    jobsQueueConfigFrom({ ...env, INTERNAL_SECRET: undefined, AGENT_API_SECRET: "a" })?.secret,
    "a",
  );
});

test("only known jobs with safe ids are accepted", () => {
  assert.deepEqual(parseJob({ kind: "score-interview", roomId: "abc_12-3" }), {
    kind: "score-interview",
    roomId: "abc_12-3",
  });
  assert.deepEqual(parseJob({ kind: "screen-application", roleId: "r1", applicationId: "a1", extra: 1 }), {
    kind: "screen-application",
    roleId: "r1",
    applicationId: "a1",
  });
  assert.deepEqual(
    parseJob({ kind: "upload-recording", roomId: "r", recordingId: "candidate-abc12345", format: "webm" }),
    { kind: "upload-recording", roomId: "r", recordingId: "candidate-abc12345", format: "webm" },
  );
  assert.equal(parseJob({ kind: "upload-recording", roomId: "r", recordingId: "candidate-1", format: "avi" }), null);
  assert.equal(parseJob({ kind: "score-interview", roomId: "../etc" }), null);
  assert.equal(parseJob({ kind: "screen-application", roleId: "r1" }), null);
  assert.equal(parseJob({ kind: "delete-everything", roomId: "a" }), null);
  assert.equal(parseJob(null), null);
});

test("the same job in the same window gets the same task id, a later window a new one", () => {
  const job = { kind: "score-interview" as const, roomId: "room1" };
  const window = JOB_WINDOW_MS["score-interview"];
  const t = 1_000 * window + 5;
  assert.equal(jobTaskId(job, window, t), jobTaskId(job, window, t + window - 10));
  assert.notEqual(jobTaskId(job, window, t), jobTaskId(job, window, t + window));
  assert.match(jobTaskId(job, window, t), /^[A-Za-z0-9_-]+$/);
});

test("the task calls back the web app's internal job route with the secret", () => {
  const config = jobsQueueConfigFrom(env)!;
  const job = { kind: "auto-invite-role" as const, roleId: "role9" };
  const body = createTaskBody(config, job, "auto-invite-role-role9-1");
  assert.equal(body.task.name, "projects/p/locations/asia-south1/queues/jobs/tasks/auto-invite-role-role9-1");
  assert.equal(body.task.httpRequest.url, "https://web.example/api/internal/jobs");
  assert.equal(body.task.httpRequest.headers["x-internal-secret"], "s3cret");
  assert.deepEqual(JSON.parse(Buffer.from(body.task.httpRequest.body, "base64").toString()), job);
});

test("the clock moves to the scheduler only when asked", () => {
  assert.equal(externalCron({}), false);
  assert.equal(externalCron({ CRON_MODE: "external" }), true);
});
