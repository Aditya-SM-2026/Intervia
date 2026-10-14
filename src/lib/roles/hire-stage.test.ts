import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareByHirePriority,
  deriveHireStage,
  HIRE_STAGE_LABELS,
} from "./hire-stage.ts";

test("a human decision always wins over interview state", () => {
  assert.equal(deriveHireStage({ status: "completed", overallScore: 90, decision: "reject" }), "rejected");
  assert.equal(deriveHireStage({ status: "active", overallScore: null, decision: "advance" }), "advanced");
  assert.equal(deriveHireStage({ status: "completed", overallScore: 40, decision: "hold" }), "on-hold");
});

test("non-completed sessions map to their honest stage", () => {
  assert.equal(deriveHireStage({ status: "scheduled", overallScore: null, decision: null }), "not-started");
  assert.equal(deriveHireStage({ status: "waiting", overallScore: null, decision: null }), "in-progress");
  assert.equal(deriveHireStage({ status: "active", overallScore: null, decision: null }), "in-progress");
  assert.equal(deriveHireStage({ status: "expired", overallScore: null, decision: null }), "dropped-out");
  assert.equal(deriveHireStage({ status: "cancelled", overallScore: null, decision: null }), "dropped-out");
});

test("completed sessions split on score and cutoff", () => {
  assert.equal(deriveHireStage({ status: "completed", overallScore: null, decision: null }), "awaiting-analysis");
  assert.equal(deriveHireStage({ status: "completed", overallScore: 64, decision: null }), "completed");
  assert.equal(
    deriveHireStage({ status: "completed", overallScore: 64, decision: null, cutoff: 70 }),
    "completed",
  );
  assert.equal(
    deriveHireStage({ status: "completed", overallScore: 72, decision: null, cutoff: 70 }),
    "ready-to-advance",
  );
  // score exactly at the cutoff counts as ready
  assert.equal(
    deriveHireStage({ status: "completed", overallScore: 70, decision: null, cutoff: 70 }),
    "ready-to-advance",
  );
  // no cutoff set: nothing is auto-labeled ready
  assert.equal(deriveHireStage({ status: "completed", overallScore: 95, decision: null }), "completed");
});

test("every stage has a human label", () => {
  for (const stage of Object.values(HIRE_STAGE_LABELS)) {
    assert.ok(stage.length > 0);
  }
});

test("priority sort: actionable stages first, then highest score", () => {
  const rows = [
    { stage: "rejected" as const, overallScore: 99 },
    { stage: "ready-to-advance" as const, overallScore: 71 },
    { stage: "in-progress" as const, overallScore: null },
    { stage: "advanced" as const, overallScore: 80 },
    { stage: "ready-to-advance" as const, overallScore: 85 },
    { stage: "completed" as const, overallScore: 60 },
  ];
  const sorted = [...rows].sort(compareByHirePriority);
  assert.deepEqual(
    sorted.map((row) => row.stage),
    ["advanced", "ready-to-advance", "ready-to-advance", "completed", "in-progress", "rejected"],
  );
  assert.equal(sorted[1].overallScore, 85);
  assert.equal(sorted[2].overallScore, 71);
});