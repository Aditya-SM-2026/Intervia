// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SKILL_WEIGHT,
  findSkillFocus,
  hasCustomWeights,
  normalizeSkillFocus,
  skillFocusPercentages,
} from "./skill-focus.ts";

test("normalize: trims names, drops blanks and duplicates, clamps weights", () => {
  const cleaned = normalizeSkillFocus([
    { skill: "  AWS  ", weight: 80 },
    { skill: "aws", weight: 20 },
    { skill: "", weight: 50 },
    { skill: "Kubernetes", weight: 140 },
    { skill: "AI", weight: -5 },
    null,
    "nope",
  ]);
  assert.deepEqual(cleaned, [
    { skill: "AWS", weight: 80 },
    { skill: "Kubernetes", weight: 100 },
    { skill: "AI", weight: 0 },
  ]);
});

test("normalize: a missing weight becomes the neutral default", () => {
  assert.deepEqual(normalizeSkillFocus([{ skill: "Go" }]), [
    { skill: "Go", weight: DEFAULT_SKILL_WEIGHT },
  ]);
  assert.deepEqual(normalizeSkillFocus("not a list"), []);
  assert.deepEqual(normalizeSkillFocus([]), []);
});

test("custom weights: only a value off the default counts as customised", () => {
  assert.equal(
    hasCustomWeights([
      { skill: "AWS", weight: 50 },
      { skill: "Go", weight: 50 },
    ]),
    false,
  );
  assert.equal(
    hasCustomWeights([
      { skill: "AWS", weight: 70 },
      { skill: "Go", weight: 50 },
    ]),
    true,
  );
});

test("percentages: relative shares that add up to 100; equal when all zero", () => {
  const shares = skillFocusPercentages([
    { skill: "AWS", weight: 75 },
    { skill: "Go", weight: 25 },
  ]);
  assert.deepEqual(
    shares.map((item) => [item.skill, item.percent]),
    [
      ["AWS", 75],
      ["Go", 25],
    ],
  );
  const even = skillFocusPercentages([
    { skill: "AWS", weight: 0 },
    { skill: "Go", weight: 0 },
  ]);
  assert.deepEqual(even.map((item) => item.percent), [50, 50]);
});

test("find: matches a parameter name case-insensitively", () => {
  const focus = [{ skill: "AWS", weight: 80 }];
  assert.equal(findSkillFocus(focus, " aws ")?.weight, 80);
  assert.equal(findSkillFocus(focus, "Kubernetes"), null);
  assert.equal(findSkillFocus(focus, null), null);
});
