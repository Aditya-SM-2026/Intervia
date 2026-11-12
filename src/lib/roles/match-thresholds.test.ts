import assert from "node:assert/strict";
import test from "node:test";

import {
  hasThresholds,
  meetsThresholds,
  fallsBelowThresholds,
  EMPTY_THRESHOLDS,
} from "./match-thresholds.ts";

test("a blank bar matches and flags nobody", () => {
  assert.equal(hasThresholds(EMPTY_THRESHOLDS), false);
  assert.equal(meetsThresholds({ screeningScore: 90, candidateCgpa: 9 }, EMPTY_THRESHOLDS), false);
  assert.equal(
    fallsBelowThresholds({ screeningScore: 10, candidateCgpa: 2 }, EMPTY_THRESHOLDS),
    false,
  );
});

test("matching needs every set half present and at the bar", () => {
  const bar = { minMatch: 60, minCgpa: 7 };
  assert.equal(meetsThresholds({ screeningScore: 60, candidateCgpa: 7 }, bar), true);
  assert.equal(meetsThresholds({ screeningScore: 59, candidateCgpa: 8 }, bar), false);
  assert.equal(meetsThresholds({ screeningScore: 80, candidateCgpa: 6.9 }, bar), false);
  assert.equal(meetsThresholds({ screeningScore: 80 }, bar), false);
  assert.equal(meetsThresholds({ candidateCgpa: 8 }, bar), false);
});

test("one half can be left blank", () => {
  assert.equal(meetsThresholds({ screeningScore: 61 }, { minMatch: 60, minCgpa: null }), true);
  assert.equal(meetsThresholds({ candidateCgpa: 7.1 }, { minMatch: null, minCgpa: 7 }), true);
  assert.equal(meetsThresholds({ screeningScore: 90, candidateCgpa: 6 }, { minMatch: null, minCgpa: 7 }), false);
});

test("below means a known number under the bar, and unknown never counts", () => {
  const bar = { minMatch: 60, minCgpa: 7 };
  assert.equal(fallsBelowThresholds({ screeningScore: 40, candidateCgpa: 8 }, bar), true);
  assert.equal(fallsBelowThresholds({ screeningScore: 80, candidateCgpa: 5 }, bar), true);
  assert.equal(fallsBelowThresholds({ screeningScore: 80, candidateCgpa: 8 }, bar), false);
  assert.equal(fallsBelowThresholds({ screeningScore: null, candidateCgpa: 2 }, bar), false);
  assert.equal(fallsBelowThresholds({ screeningScore: 20, candidateCgpa: null }, bar), false);
  assert.equal(fallsBelowThresholds({}, bar), false);
});
