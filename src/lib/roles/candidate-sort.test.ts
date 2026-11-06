// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareCandidateRows,
  type SortState,
  type SortableCandidateRow,
} from "./candidate-sort.ts";
import type { RoleCandidateSummary } from "./role.types.ts";

function row(overrides: Partial<RoleCandidateSummary>): SortableCandidateRow {
  return {
    stage: "completed",
    candidate: {
      candidateId: "candidate",
      candidateEmail: "candidate@example.com",
      candidateName: "Candidate",
      interviews: 1,
      completed: 0,
      pending: 1,
      latestInterviewId: "interview",
      latestInterviewAt: "2026-01-01T10:00:00.000Z",
      scheduledAt: null,
      completedAt: null,
      latestStatus: "scheduled",
      overallScore: null,
      suggestion: null,
      decision: null,
      applicationId: null,
      applicationStatus: null,
      appliedAt: null,
      candidatePhone: null,
      candidateCollegeId: null,
      answers: null,
      ...overrides,
    },
  };
}

function sorted(rows: SortableCandidateRow[], sort: SortState): string[] {
  return [...rows].sort((a, b) => compareCandidateRows(a, b, sort)).map(
    (item) => item.candidate.candidateId,
  );
}

test("candidate name sorts A to Z and back", () => {
  const rows = [
    row({ candidateId: "c", candidateName: "chandra" }),
    row({ candidateId: "a", candidateName: "Aarav" }),
    row({ candidateId: "b", candidateName: "Diya" }),
  ];
  assert.deepEqual(sorted(rows, { key: "candidate", direction: "asc" }), ["a", "c", "b"]);
  assert.deepEqual(sorted(rows, { key: "candidate", direction: "desc" }), ["b", "c", "a"]);
});

test("scores sort numerically, not as text", () => {
  const rows = [
    row({ candidateId: "nine", overallScore: 9 }),
    row({ candidateId: "eighty", overallScore: 80 }),
    row({ candidateId: "sixty", overallScore: 60 }),
  ];
  assert.deepEqual(sorted(rows, { key: "score", direction: "asc" }), ["nine", "sixty", "eighty"]);
  assert.deepEqual(sorted(rows, { key: "score", direction: "desc" }), ["eighty", "sixty", "nine"]);
});

test("missing values stay at the bottom in both directions", () => {
  const rows = [
    row({ candidateId: "none" }),
    row({ candidateId: "mid", overallScore: 50 }),
    row({ candidateId: "top", overallScore: 90 }),
  ];
  assert.deepEqual(sorted(rows, { key: "score", direction: "asc" }), ["mid", "top", "none"]);
  assert.deepEqual(sorted(rows, { key: "score", direction: "desc" }), ["top", "mid", "none"]);
});

test("dates sort chronologically and fall back to the interview date", () => {
  const rows = [
    row({ candidateId: "later", appliedAt: "2026-03-02T10:00:00.000Z" }),
    row({ candidateId: "earlier", appliedAt: "2026-01-02T10:00:00.000Z" }),
  ];
  assert.deepEqual(sorted(rows, { key: "applied", direction: "asc" }), ["earlier", "later"]);

  const interviews = [
    row({ candidateId: "scheduled", scheduledAt: "2026-05-02T10:00:00.000Z" }),
    row({ candidateId: "fallback", latestInterviewId: "old", latestInterviewAt: "2026-02-01T10:00:00.000Z" }),
  ];
  assert.deepEqual(sorted(interviews, { key: "interview", direction: "asc" }), ["fallback", "scheduled"]);
  assert.deepEqual(sorted(interviews, { key: "interview", direction: "desc" }), ["scheduled", "fallback"]);
});

test("status follows the interview pipeline order, not the alphabet", () => {
  const rows = [
    row({ candidateId: "cancelled", latestStatus: "cancelled" }),
    row({ candidateId: "scheduled", latestStatus: "scheduled" }),
    row({ candidateId: "completed", latestStatus: "completed" }),
    row({ candidateId: "waiting", latestStatus: "waiting" }),
  ];
  assert.deepEqual(sorted(rows, { key: "status", direction: "asc" }), [
    "scheduled",
    "waiting",
    "completed",
    "cancelled",
  ]);
});

test("a candidate with no application date sinks below dated rows", () => {
  const rows = [
    row({ candidateId: "undated" }),
    row({ candidateId: "dated", appliedAt: "2026-01-02T10:00:00.000Z" }),
  ];
  assert.deepEqual(sorted(rows, { key: "applied", direction: "asc" }), ["dated", "undated"]);
  assert.deepEqual(sorted(rows, { key: "applied", direction: "desc" }), ["dated", "undated"]);
});
