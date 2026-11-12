// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCutoff,
  educationLabel,
  passesCgpaFilter,
  passesShortlistFilter,
  shortlistStatusFor,
} from "./shortlist.ts";

test("the cutoff decides only when nobody has ticked the candidate", () => {
  assert.equal(shortlistStatusFor(null, 72, 60), "shortlisted");
  assert.equal(shortlistStatusFor(null, 41, 60), "below_cutoff");
  assert.equal(shortlistStatusFor(null, null, 60), "not_scored");
});

test("a manual tick wins over the cutoff in both directions", () => {
  assert.equal(shortlistStatusFor(true, 10, 90), "shortlisted");
  assert.equal(shortlistStatusFor(false, 99, 10), "below_cutoff");
});

test("no cutoff means nothing is shortlisted automatically", () => {
  assert.equal(shortlistStatusFor(null, 95, 0), "not_scored");
  assert.equal(shortlistStatusFor(true, 95, 0), "shortlisted");
});

test("cutoffs stay whole numbers between 0 and 100", () => {
  assert.equal(clampCutoff(-20), 0);
  assert.equal(clampCutoff(61.6), 62);
  assert.equal(clampCutoff(140), 100);
  assert.equal(clampCutoff(Number.NaN), 0);
});

test("the shortlisted-only filter keeps just shortlisted rows", () => {
  assert.equal(passesShortlistFilter("shortlisted", true), true);
  assert.equal(passesShortlistFilter("below_cutoff", true), false);
  assert.equal(passesShortlistFilter("not_scored", true), false);
  assert.equal(passesShortlistFilter("below_cutoff", false), true);
});

test("a CGPA filter never passes a blank CGPA", () => {
  assert.equal(passesCgpaFilter(8.4, 7), true);
  assert.equal(passesCgpaFilter(6.1, 7), false);
  assert.equal(passesCgpaFilter(null, 7), false);
  assert.equal(passesCgpaFilter(null, 0), true);
  assert.equal(passesCgpaFilter(6.1, 0), true);
});

test("the education cell joins the qualification and the CGPA", () => {
  assert.equal(educationLabel("B.Tech", 8.4), "B.Tech · CGPA 8.4");
  assert.equal(educationLabel("B.Tech", null), "B.Tech");
  assert.equal(educationLabel(null, 78), "CGPA 78");
  assert.equal(educationLabel(null, null), null);
  assert.equal(educationLabel("  ", null), null);
});
