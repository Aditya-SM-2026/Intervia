// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateCandidates,
  computeRoleStats,
  matchesRoleAssociation,
  type AggregationInterview,
  type AggregationScorecard,
} from "./candidate-aggregation.ts";

function interview(overrides: Partial<AggregationInterview> = {}): AggregationInterview {
  return {
    id: "room_a",
    title: "Backend interview",
    candidateName: "Priya",
    candidateEmail: "priya@example.com",
    status: "completed",
    createdAt: "2026-10-13T10:00:00.000Z",
    completedAt: "2026-10-13T10:30:00.000Z",
    decision: null,
    resumeFileName: null,
    resumeText: null,
    roleId: "role_1",
    roleTitle: "Backend Engineer",
    ...overrides,
  };
}

function scorecard(overrides: Partial<AggregationScorecard> = {}): AggregationScorecard {
  return { overallScore: 70, suggestion: "strong", needsHumanReview: false, ...overrides };
}

test("role association matches by id, or legacy title when role_id is null", () => {
  assert.equal(matchesRoleAssociation("role_1", "T", interview()), true);
  assert.equal(
    matchesRoleAssociation("role_1", "T", interview({ roleId: null, roleTitle: "T" })),
    true,
  );
  assert.equal(matchesRoleAssociation("role_1", "T", interview({ roleId: "role_2" })), false);
  assert.equal(matchesRoleAssociation("role_1", "T", interview({ roleId: null, roleTitle: "Other" })), false);
});

test("aggregateCandidates groups by email and keeps the newest interview", () => {
  const interviews = [
    interview({ id: "old", createdAt: "2026-10-01T10:00:00.000Z", status: "expired", candidateName: "Old Name" }),
    interview({ id: "new", createdAt: "2026-10-10T10:00:00.000Z" }),
    interview({ id: "other", candidateEmail: "arjun@example.com", candidateName: "Arjun", createdAt: "2026-10-11T10:00:00.000Z" }),
  ];
  const scorecards = new Map([
    ["new", scorecard({ overallScore: 82 })],
    ["old", scorecard({ overallScore: 10 })],
  ]);
  const rows = aggregateCandidates("role_1", "Backend Engineer", interviews, scorecards);
  assert.equal(rows.length, 2);
  // Newest first.
  assert.equal(rows[0]!.candidateEmail, "arjun@example.com");
  assert.equal(rows[1]!.candidateEmail, "priya@example.com");
  // Latest interview carries status and score; the stale low score is ignored.
  assert.equal(rows[1]!.roomId, "new");
  assert.equal(rows[1]!.latestStatus, "completed");
  assert.equal(rows[1]!.overallScore, 82);
  // Counts cover both interviews; pending is derived (interviews - completed).
  assert.equal(rows[1]!.interviews, 2);
  assert.equal(rows[1]!.completed, 1);
});

test("aggregateCandidates ignores interviews without email and picks first non-null name", () => {
  const interviews = [
    interview({ id: "no_email", candidateEmail: null }),
    interview({ id: "later", createdAt: "2026-10-12T10:00:00.000Z", candidateName: null }),
    interview({ id: "earlier", createdAt: "2026-10-02T10:00:00.000Z", candidateName: "Early Name" }),
  ];
  const rows = aggregateCandidates("role_1", "T", interviews, new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.candidateName, "Early Name");
  assert.equal(rows[0]!.interviews, 2);
});

test("aggregateCandidates stays scoped to one role", () => {
  const interviews = [
    interview(),
    interview({ id: "x", roleId: "role_2", candidateEmail: "someone@example.com" }),
    interview({ id: "y", roleId: null, roleTitle: "Different Role", candidateEmail: "else@example.com" }),
  ];
  const rows = aggregateCandidates("role_1", "Backend Engineer", interviews, new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.candidateEmail, "priya@example.com");
});

test("computeRoleStats derives counts and average score from real data", () => {
  const interviews = [
    interview({ id: "a" }),
    interview({ id: "b", createdAt: "2026-10-09T10:00:00.000Z" }),
    interview({ id: "c", candidateEmail: "arjun@example.com", status: "active" }),
    interview({ id: "d", candidateEmail: null, status: "waiting" }),
    interview({ id: "e", roleId: "role_2" }),
  ];
  const scorecards = new Map([
    ["a", scorecard({ overallScore: 60 })],
    ["b", scorecard({ overallScore: 80 })],
  ]);
  const stats = computeRoleStats("role_1", "Backend Engineer", interviews, scorecards);
  assert.deepEqual(stats, {
    interviews: 4,
    candidates: 2,
    completed: 2,
    pending: 2,
    avgOverallScore: 70,
  });
});

test("computeRoleStats returns zeroed stats for a role without interviews", () => {
  const stats = computeRoleStats("role_empty", "Nothing", [], new Map());
  assert.deepEqual(stats, {
    interviews: 0,
    candidates: 0,
    completed: 0,
    pending: 0,
    avgOverallScore: null,
  });
});

test("missing scorecards never produce invented averages", () => {
  const stats = computeRoleStats(
    "role_1",
    "T",
    [interview({ id: "a" }), interview({ id: "b", createdAt: "2026-10-09T10:00:00.000Z" })],
    new Map(),
  );
  assert.equal(stats.completed, 2);
  assert.equal(stats.avgOverallScore, null);
});