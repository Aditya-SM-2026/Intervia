import assert from "node:assert/strict";
import test from "node:test";
import {
  compareByCandidateStatus,
  deriveCandidateStatus,
  interviewIsLive,
  interviewStateFor,
  CANDIDATE_STATUS_LABELS,
  SHORTLIST_SCORE,
  type CandidateStatus,
} from "./candidate-status.ts";

test("the six statuses are exactly the agreed pipeline", () => {
  assert.deepEqual(Object.keys(CANDIDATE_STATUS_LABELS).sort(), [
    "advanced",
    "applied",
    "on-hold",
    "rejected",
    "selected",
    "shortlisted",
  ]);
});

test("an application with nothing else decided is Applied", () => {
  assert.equal(deriveCandidateStatus({ decision: null }), "applied");
  assert.equal(
    deriveCandidateStatus({ decision: null, applicationStatus: "new", screeningScore: null }),
    "applied",
  );
  assert.equal(deriveCandidateStatus({ decision: null, screeningScore: 40 }), "applied");
});

test("a Match score above 60 is Shortlisted, on its own", () => {
  assert.equal(deriveCandidateStatus({ decision: null, screeningScore: 61 }), "shortlisted");
  assert.equal(
    deriveCandidateStatus({ decision: null, screeningScore: SHORTLIST_SCORE }),
    "applied",
  );
  assert.equal(deriveCandidateStatus({ decision: null, screeningScore: 40, manualShortlist: true }), "shortlisted");
  assert.equal(deriveCandidateStatus({ decision: null, screeningScore: 90, manualShortlist: false }), "applied");
});

test("completing the interview is Advanced", () => {
  assert.equal(
    deriveCandidateStatus({ decision: null, interviewState: "completed" }),
    "advanced",
  );
  assert.equal(
    deriveCandidateStatus({ decision: null, interviewState: "evaluated", screeningScore: 90 }),
    "advanced",
  );
  assert.equal(
    deriveCandidateStatus({ decision: null, interviewState: "scheduled", screeningScore: 90 }),
    "shortlisted",
  );
});

test("a recruiter decision beats everything else", () => {
  assert.equal(deriveCandidateStatus({ decision: "advance", screeningScore: 10 }), "selected");
  assert.equal(
    deriveCandidateStatus({ decision: "hold", interviewState: "evaluated", screeningScore: 90 }),
    "on-hold",
  );
  assert.equal(deriveCandidateStatus({ decision: "reject", screeningScore: 90 }), "rejected");
  assert.equal(deriveCandidateStatus({ decision: "reject", applicationStatus: "rejected" }), "rejected");
});

test("a rejected application is Rejected even without an interview", () => {
  assert.equal(deriveCandidateStatus({ decision: null, applicationStatus: "rejected" }), "rejected");
});

test("statuses sort in pipeline order, rejected last", () => {
  const sorted = (
    ["rejected", "selected", "on-hold", "advanced", "shortlisted", "applied"] as CandidateStatus[]
  ).sort(compareByCandidateStatus);
  assert.deepEqual(sorted, [
    "applied",
    "shortlisted",
    "advanced",
    "on-hold",
    "selected",
    "rejected",
  ]);
});

/* ------------------------------ interviews ------------------------------- */

const T0 = Date.parse("2026-11-12T10:00:00.000Z");

test("no interview at all is Not scheduled", () => {
  assert.equal(interviewStateFor({ interviews: 0, status: "scheduled" }), "not-scheduled");
});

test("an interview whose window closed is not In progress", () => {
  assert.equal(
    interviewStateFor({
      interviews: 1,
      status: "active",
      expiresAt: "2026-11-12T09:00:00.000Z",
      now: T0,
    }),
    "expired",
  );
  assert.equal(
    interviewStateFor({
      interviews: 1,
      status: "waiting",
      expiresAt: "2026-11-12T09:00:00.000Z",
      now: T0,
    }),
    "expired",
  );
});

test("a live interview keeps its honest state", () => {
  assert.equal(
    interviewStateFor({
      interviews: 1,
      status: "active",
      expiresAt: "2026-11-12T11:30:00.000Z",
      now: T0,
    }),
    "in-progress",
  );
  assert.equal(interviewStateFor({ interviews: 1, status: "waiting", now: T0 }), "link-opened");
  assert.equal(interviewStateFor({ interviews: 1, status: "scheduled", now: T0 }), "scheduled");
});

test("completion and evaluation are separate states", () => {
  assert.equal(
    interviewStateFor({ interviews: 1, status: "completed", overallScore: null }),
    "completed",
  );
  assert.equal(
    interviewStateFor({ interviews: 1, status: "completed", overallScore: 72 }),
    "evaluated",
  );
});

test("only a running or opened interview counts as live", () => {
  assert.equal(interviewIsLive("in-progress"), true);
  assert.equal(interviewIsLive("link-opened"), true);
  assert.equal(interviewIsLive("scheduled"), false);
  assert.equal(interviewIsLive("completed"), false);
  assert.equal(interviewIsLive("expired"), false);
});
