// Run with: npm test  (node --test, no model or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WEIGHTS,
  answerQualityScore,
  authenticityScore,
  measuredAuthenticitySignals,
  overallScore,
  parseWeights,
  resumeMatchScore,
  gazePattern,
  videoBehaviourScore,
} from "./scoring.ts";
import type {
  AnswerGaze,
  CompetencyScore,
  GazeDirection,
  ResumeClaim,
  VideoMoment,
} from "./scorecard.types.ts";

function competency(id: string, score: number | null): CompetencyScore {
  return {
    competencyId: id,
    name: id,
    status: score === null ? "not_assessed" : "scored",
    score,
    rationale: "",
    evidence: [],
    gaps: [],
    secondScore: null,
    judgesAgree: null,
  };
}

function claim(verdict: ResumeClaim["verdict"]): ResumeClaim {
  return { claim: "x", verdict, note: "", turnSeqs: [] };
}

test("answer quality: a 3 is 60, a 5 is 100, weighted by plan time", () => {
  const minutes = new Map([
    ["a", 6],
    ["b", 2],
  ]);
  assert.equal(answerQualityScore([competency("a", 3)], minutes), 60);
  assert.equal(answerQualityScore([competency("a", 5)], minutes), 100);
  // (5*6 + 1*2) / 8 = 4.0 -> 80
  assert.equal(answerQualityScore([competency("a", 5), competency("b", 1)], minutes), 80);
});

test("answer quality: unscored topics are ignored; none scored gives no score", () => {
  const minutes = new Map([["a", 5]]);
  assert.equal(answerQualityScore([competency("a", 4), competency("b", null)], minutes), 80);
  assert.equal(answerQualityScore([competency("a", null)], minutes), null);
});

test("resume match: only discussed claims count", () => {
  assert.equal(
    resumeMatchScore([claim("confirmed"), claim("confirmed"), claim("not_discussed")]),
    100,
  );
  assert.equal(resumeMatchScore([claim("confirmed"), claim("not_supported")]), 50);
  assert.equal(resumeMatchScore([claim("partly_supported"), claim("partly_supported")]), 50);
});

test("resume match: too few discussed claims gives no score", () => {
  assert.equal(resumeMatchScore([claim("confirmed"), claim("not_discussed")]), null);
  assert.equal(resumeMatchScore([]), null);
});

test("own answers: no signals is 100, signals subtract by severity", () => {
  const signal = (severity: 1 | 2 | 3) => ({
    title: "",
    detail: "",
    turnSeqs: [1],
    severity,
    source: "grader" as const,
  });
  assert.equal(authenticityScore([]), 100);
  assert.equal(authenticityScore([signal(1)]), 94);
  assert.equal(authenticityScore([signal(2), signal(3)]), 60);
  assert.equal(authenticityScore([signal(3), signal(3), signal(3), signal(3)]), 0);
});

test("on-camera behaviour: one glance costs little, a pattern adds up", () => {
  const moment = (kind: VideoMoment["kind"], durationSeconds: number): VideoMoment => ({
    atSeconds: 0,
    durationSeconds,
    kind,
    description: "",
  });
  const quiet = { hiddenCount: 0, hiddenSeconds: 0 };
  assert.equal(videoBehaviourScore([], quiet), 100);
  assert.equal(videoBehaviourScore([moment("looking_away", 10)], quiet), 94);
  assert.equal(videoBehaviourScore([moment("other_person", 20)], quiet), 70);
  assert.ok(videoBehaviourScore(Array(6).fill(moment("reading", 30)), quiet) < 30);
  // Tab switches are capped so they cannot zero the score alone.
  assert.equal(videoBehaviourScore([], { hiddenCount: 20, hiddenSeconds: 600 }), 70);
});

test("overall: weighted average of the factors that have a score", () => {
  const all = overallScore({ answers: 80, resume: 100, authenticity: 60, video: 40 });
  // (80*45 + 100*20 + 60*20 + 40*15) / 100 = 74
  assert.equal(all.score, 74);
  assert.deepEqual(
    all.factors.map((factor) => factor.weight),
    [45, 20, 20, 15],
  );
});

test("overall: a missing factor is left out, not counted as zero", () => {
  const noVideo = overallScore({ answers: 80, resume: 100, authenticity: 60, video: null });
  // (80*45 + 100*20 + 60*20) / 85 = 80
  assert.equal(noVideo.score, 80);
  assert.equal(noVideo.factors.find((factor) => factor.id === "video")?.score, null);
});

test("overall: no scored answers means no overall score", () => {
  assert.equal(overallScore({ answers: null, resume: 90, authenticity: 90, video: 90 }).score, null);
});

test("weights setting: valid values are used, anything else falls back", () => {
  assert.deepEqual(parseWeights("50,20,20,10"), { answers: 50, resume: 20, authenticity: 20, video: 10 });
  assert.deepEqual(parseWeights("1,2,3"), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights("a,b,c,d"), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights(undefined), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights("0,0,0,0"), DEFAULT_WEIGHTS);
});

test("measured signal: a long answer that starts instantly, against a usual pause", () => {
  const answers = [
    { seq: 2, responseLatencyMs: 2100, durationMs: 30000, wordCount: 70 },
    { seq: 4, responseLatencyMs: 1900, durationMs: 40000, wordCount: 95 },
    { seq: 6, responseLatencyMs: 2400, durationMs: 20000, wordCount: 40 },
    { seq: 8, responseLatencyMs: 300, durationMs: 70000, wordCount: 160 },
    { seq: 10, responseLatencyMs: 2000, durationMs: 25000, wordCount: 60 },
  ];
  const signals = measuredAuthenticitySignals(answers);
  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].turnSeqs, [8]);
  assert.equal(signals[0].severity, 1);
  assert.equal(signals[0].source, "measured");
});

test("measured signal: nothing flagged for short quick replies or too little data", () => {
  const quickShort = [1, 2, 3, 4, 5].map((seq) => ({
    seq,
    responseLatencyMs: 300,
    durationMs: 3000,
    wordCount: 8,
  }));
  assert.deepEqual(measuredAuthenticitySignals(quickShort), []);
  assert.deepEqual(
    measuredAuthenticitySignals([{ seq: 1, responseLatencyMs: 100, durationMs: 90000, wordCount: 200 }]),
    [],
  );
});

function gaze(
  seq: number,
  whileAnswering: GazeDirection,
  options: Partial<AnswerGaze> = {},
): AnswerGaze {
  return {
    turnSeq: seq,
    atSeconds: seq * 30,
    durationSeconds: 20,
    whileListening: "centre",
    whileAnswering,
    steady: true,
    reading: false,
    note: "",
    ...options,
  };
}

test("gaze pattern: the same off-screen spot across answers is what counts", () => {
  const quiet = { hiddenCount: 0, hiddenSeconds: 0 };

  // Looks at the interview window throughout: nothing to report.
  const normal = gazePattern([1, 2, 3, 4].map((seq) => gaze(seq, "centre")));
  assert.equal(normal.sameSpotAnswers, 0);
  assert.equal(videoBehaviourScore([], quiet, normal), 100);

  // Thinks while looking in different directions, not held: not a pattern.
  const thinking = gazePattern([
    gaze(1, "up", { steady: false }),
    gaze(2, "left", { steady: false }),
    gaze(3, "centre"),
    gaze(4, "up_right", { steady: false }),
  ]);
  assert.equal(thinking.sameSpotAnswers, 0);
  assert.equal(videoBehaviourScore([], quiet, thinking), 100);

  // Every answer given to the same spot down and to the left.
  const fixed = gazePattern([1, 2, 3, 4, 5].map((seq) => gaze(seq, "down_left")));
  assert.equal(fixed.direction, "down_left");
  assert.equal(fixed.sameSpotAnswers, 5);
  assert.equal(videoBehaviourScore([], quiet, fixed), 40);

  // Where they look while listening is the baseline, even when it is not the centre.
  const lowWindow = gazePattern(
    [1, 2, 3, 4].map((seq) => gaze(seq, "down", { whileListening: "down" })),
  );
  assert.equal(lowWindow.listeningDirection, "down");
  assert.equal(lowWindow.sameSpotAnswers, 0);

  // One answer looking away is not a pattern and costs nothing.
  const once = gazePattern([gaze(1, "right"), gaze(2, "centre"), gaze(3, "centre"), gaze(4, "centre")]);
  assert.equal(videoBehaviourScore([], quiet, once), 100);

  // Very short and unreadable answers are left out of the count.
  const sparse = gazePattern([
    gaze(1, "right", { durationSeconds: 2 }),
    gaze(2, "unclear"),
    gaze(3, "right"),
  ]);
  assert.equal(sparse.answersObserved, 1);
  assert.equal(videoBehaviourScore([], quiet, sparse), 100);

  // Reading-like eye movement costs points per answer.
  const reading = gazePattern([1, 2, 3].map((seq) => gaze(seq, "centre", { reading: true })));
  assert.equal(videoBehaviourScore([], quiet, reading), 70);
});
