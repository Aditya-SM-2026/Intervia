// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRoleCandidatesCsv,
  csvCell,
  csvRow,
  exportFileName,
  roleSlug,
} from "./roles-csv.ts";
import type { RoleCandidateSummary } from "./role.types.ts";

function candidate(overrides: Partial<RoleCandidateSummary> = {}): RoleCandidateSummary {
  return {
    candidateId: "priya@example.com",
    candidateEmail: "priya@example.com",
    candidateName: "Priya Sharma",
    interviews: 1,
    completed: 1,
    pending: 0,
    latestInterviewId: "abc12345",
    latestInterviewAt: "2026-10-13T10:00:00.000Z",
    latestStatus: "completed",
    overallScore: 78,
    suggestion: "strong",
    decision: null,
    ...overrides,
  };
}

test("csvCell escapes commas, quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(78), "78");
});

test("csvCell neutralises formula injection prefixes", () => {
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("-2;--"), "'-2;--");
  assert.equal(csvCell("@evil"), "'@evil");
  assert.equal(csvCell("\t=cmd"), "'\t=cmd");
  // A CR makes the value need quoting; the guard prefix stays.
  assert.equal(csvCell("\r=cmd"), "\"'\r=cmd\"");
  // Values that merely contain formula characters are untouched.
  assert.equal(csvCell("total = 5"), "total = 5");
});

test("csvRow joins cells with commas", () => {
  assert.equal(csvRow(["a", 1, null]), "a,1,");
});

test("buildRoleCandidatesCsv has the expected headers and rows", () => {
  const csv = buildRoleCandidatesCsv(
    { roleId: "role_x", roleTitle: "Senior Engineer", roleStatus: "open" },
    [candidate()],
  );
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line !== "");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    "Role ID,Role Title,Role Status,Candidate Name,Candidate Email,Interview ID,Interview Status,Interview Date,Overall Score,Evaluation,Decision,Interviews,Completed",
  );
  assert.equal(
    lines[1],
    "role_x,Senior Engineer,Open,Priya Sharma,priya@example.com,abc12345,Completed,2026-10-13,78,Strong,,1,1",
  );
});

test("buildRoleCandidatesCsv represents missing scores and pending interviews honestly", () => {
  const csv = buildRoleCandidatesCsv(
    { roleId: "role_x", roleTitle: "Q&A", roleStatus: "open" },
    [
      candidate({ overallScore: null, suggestion: null, latestStatus: "active", completed: 0, pending: 1 }),
      candidate({ candidateEmail: "n@example.com", candidateId: "n@example.com", overallScore: null, suggestion: null, candidateName: null }),
    ],
  );
  const rows = csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line !== "");
  // No invented values: empty score, explicit evaluation state.
  assert.match(rows[1]!, /,In progress,2026-10-13,,Interview pending,,1,0$/);
  assert.match(rows[2]!, /,Completed,2026-10-13,,Not scored,,1,1$/);
});

test("buildRoleCandidatesCsv escapes and protects untrusted values", () => {
  const csv = buildRoleCandidatesCsv(
    { roleId: "role_x", roleTitle: "Weird, Role", roleStatus: "open" },
    [
      candidate({
        candidateName: 'Doe, Jane "=HACK"',
        candidateEmail: "x,y@example.com",
        candidateId: "x,y@example.com",
      }),
      candidate({ candidateName: "=SUM(A1)", candidateEmail: "z@example.com", candidateId: "z@example.com" }),
    ],
  );
  // Comma/quote values are quoted with doubled quotes; that alone is safe.
  assert.match(csv, /"Doe, Jane ""=HACK"""/);
  assert.match(csv, /"x,y@example\.com"/);
  assert.match(csv, /"Weird, Role"/);
  // A cell that STARTS with a formula character gets neutralised.
  assert.match(csv, /'=SUM\(A1\)/);
});

test("buildRoleCandidatesCsv shows the decision when one exists", () => {
  const csv = buildRoleCandidatesCsv(
    { roleId: "role_x", roleTitle: "R", roleStatus: "completed" },
    [candidate({ decision: { outcome: "advance", note: "", decidedAt: "2026-10-13T11:00:00.000Z" } })],
  );
  assert.match(csv, /,Advanced,/);
});

test("buildRoleCandidatesCsv returns header-only CSV for an empty role", () => {
  const csv = buildRoleCandidatesCsv(
    { roleId: "role_x", roleTitle: "Empty", roleStatus: "open" },
    [],
  );
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line !== "");
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^Role ID,/);
});

test("roleSlug lowercases and strips unsafe characters", () => {
  assert.equal(roleSlug("Senior Backend Engineer"), "senior-backend-engineer");
  assert.equal(roleSlug("C++ / Systems!"), "c-systems");
  assert.equal(roleSlug("   "), "role");
});

test("exportFileName contains the role slug and export date", () => {
  assert.equal(
    exportFileName("Senior Engineer", new Date("2026-10-13T09:30:00Z")),
    "candidates-senior-engineer-2026-10-13.csv",
  );
});