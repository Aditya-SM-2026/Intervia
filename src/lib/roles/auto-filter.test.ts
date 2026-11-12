import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTO_FILTER_RULE,
  isAutoFiltered,
  sanitizeAutoFilterRule,
} from "./auto-filter.ts";

test("both halves of the rule have to be true", () => {
  assert.equal(isAutoFiltered({ screeningScore: 49, candidateCgpa: 5.9 }), true);
  assert.equal(isAutoFiltered({ screeningScore: 49, candidateCgpa: 8 }), false);
  assert.equal(isAutoFiltered({ screeningScore: 80, candidateCgpa: 5.9 }), false);
  assert.equal(isAutoFiltered({ screeningScore: 80, candidateCgpa: 8 }), false);
});

test("the rule is per role now, not fixed", () => {
  const rule = { matchBelow: 70, cgpaBelow: 7.5 };
  assert.equal(isAutoFiltered({ screeningScore: 65, candidateCgpa: 7 }, rule), true);
  assert.equal(isAutoFiltered({ screeningScore: 75, candidateCgpa: 7 }, rule), false);
  assert.equal(DEFAULT_AUTO_FILTER_RULE.matchBelow, 50);
  assert.equal(DEFAULT_AUTO_FILTER_RULE.cgpaBelow, 6);
});

test("the limits themselves are kept", () => {
  assert.equal(
    isAutoFiltered({ screeningScore: DEFAULT_AUTO_FILTER_RULE.matchBelow, candidateCgpa: 5 }),
    false,
  );
  assert.equal(
    isAutoFiltered({ screeningScore: 20, candidateCgpa: DEFAULT_AUTO_FILTER_RULE.cgpaBelow }),
    false,
  );
});

test("unknown numbers are never swept up", () => {
  assert.equal(isAutoFiltered({ screeningScore: null, candidateCgpa: 5 }), false);
  assert.equal(isAutoFiltered({ screeningScore: 30, candidateCgpa: null }), false);
  assert.equal(isAutoFiltered({ screeningScore: 30 }), false);
  assert.equal(isAutoFiltered({}), false);
  assert.equal(isAutoFiltered({ screeningScore: Number.NaN, candidateCgpa: 5 }), false);
});

test("a saved rule is clamped to something usable", () => {
  assert.deepEqual(sanitizeAutoFilterRule({ matchBelow: 140, cgpaBelow: -3 }), {
    matchBelow: 100,
    cgpaBelow: 0,
  });
  assert.deepEqual(sanitizeAutoFilterRule({ matchBelow: "70", cgpaBelow: "7.25" }), {
    matchBelow: 70,
    cgpaBelow: 7.3,
  });
  assert.deepEqual(sanitizeAutoFilterRule(undefined), DEFAULT_AUTO_FILTER_RULE);
  assert.deepEqual(sanitizeAutoFilterRule({ matchBelow: "no", cgpaBelow: null }), DEFAULT_AUTO_FILTER_RULE);
});
