// Run with: npm test  (node --test, no model or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WEIGHTS,
  answerQualityScore,
  buildIntegrityCheck,
  cappedAnswerScore,
  integrityLevel,
  measuredFindings,
  ownAnswersFactor,
  ownAnswerTally,
  verdictsByCompetency,
  authenticityScore,
  customScore,
  measuredAuthenticitySignals,
  overallScore,
  parseWeights,
  resumeMatchScore,
  gazePattern,
  videoBehaviourScore,
} from "./scoring.ts";
import type {
  AnswerGaze,
  AnswerMeasures,
  VideoMeasures,
  CompetencyScore,
  CustomParameterScore,
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

function parameter(
  skill: string,
  weight: number,
  score: number | null,
): CustomParameterScore {
  return {
    skill,
    weight,
    status: score === null ? "not_assessed" : "scored",
    score,
    rationale: "",
    evidence: [],
    resumeEvidence: null,
    gaps: [],
  };
}

test("custom parameters: weighted by the recruiter's emphasis", () => {
  assert.equal(
    customScore([parameter("AWS", 80, 90), parameter("English", 40, 60)]),
    80,
  );
  assert.equal(
    customScore([parameter("AWS", 50, 40), parameter("English", 50, 80)]),
    60,
  );
  // Unscored parameters are left out, not counted as zero.
  assert.equal(customScore([parameter("AWS", 80, 90), parameter("English", 40, null)]), 90);
  // Weight 0 parameters do not drag the total down.
  assert.equal(customScore([parameter("AWS", 80, 90), parameter("Extra", 0, 10)]), 90);
  // All weights zero: the scored ones count equally.
  assert.equal(customScore([parameter("AWS", 0, 40), parameter("English", 0, 80)]), 60);
  assert.equal(customScore([parameter("AWS", 50, null)]), null);
  assert.equal(customScore([]), null);
});

test("overall: answers 70, resume 20, own answers 10; video measured but weighted 0", () => {
  const all = overallScore({ answers: 80, resume: 100, authenticity: 60, video: 40 });
  // (80*70 + 100*20 + 60*10) / 100 = 82; video is left out at weight 0.
  assert.equal(all.score, 82);
  assert.deepEqual(all.factors.map((factor) => factor.id), ["answers", "resume", "authenticity"]);
});

test("own answers: judged per question, only on the good answers", () => {
  const comp = (id: string, score: number) =>
    ({ competencyId: id, name: id, status: "scored", score, rationale: "", evidence: [], gaps: [], secondScore: null, judgesAgree: null }) as CompetencyScore;
  // Gayathri: 3,2,3,2,2; both good answers natural -> 100 over 2 good answers.
  const gayathri = [comp("a", 3), comp("b", 2), comp("c", 3), comp("d", 2), comp("e", 2)];
  const tally = ownAnswerTally(gayathri, new Map());
  assert.deepEqual(tally, { scored: 5, good: 2, goodOwn: 2 });
  assert.equal(ownAnswersFactor(tally), 100);
  // Strong but mostly read out: 4 good answers, 3 read -> (0.1*3 + 1) / 4 = 33.
  const strong = [comp("a", 4), comp("b", 4), comp("c", 5), comp("d", 4)];
  const read = new Map([["a", "likely_read"], ["b", "likely_read"], ["c", "likely_read"]] as const);
  assert.equal(ownAnswersFactor(ownAnswerTally(strong, read)), 33);
  assert.equal(ownAnswersFactor(ownAnswerTally(strong, new Map())), 100);
  assert.equal(ownAnswersFactor(ownAnswerTally([comp("a", 4), comp("b", 4)], new Map([["a", "polished"]] as const))), 80);
  // No good answers: nothing to judge, so no score (left out of the total).
  assert.equal(ownAnswersFactor(ownAnswerTally([comp("a", 2), comp("b", 1)], new Map())), null);
  assert.equal(ownAnswersFactor(null), null);
  const byComp = verdictsByCompetency(
    [{ turnSeq: 1, verdict: "natural" }, { turnSeq: 2, verdict: "likely_read" }],
    new Map([[1, "a"], [2, "a"]]),
  );
  assert.equal(byComp.get("a"), "likely_read");
});

test("overall: a missing factor is left out, not counted as zero", () => {
  const noResume = overallScore({ answers: 70, resume: null, authenticity: null, video: null });
  assert.equal(noResume.score, 70);
  assert.equal(noResume.factors.find((factor) => factor.id === "resume")?.score, null);
});

test("overall: no scored answers means no overall score", () => {
  assert.equal(overallScore({ answers: null, resume: 90, authenticity: 90, video: 90 }).score, null);
});

test("weights setting: four parts, video can be switched on later", () => {
  assert.deepEqual(parseWeights("60,20,10,10"), { answers: 60, resume: 20, authenticity: 10, video: 10 });
  assert.deepEqual(parseWeights("70,30"), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights("a,b,c,d"), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights(undefined), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights("0,0,0,0"), DEFAULT_WEIGHTS);
});

test("answer caps: off the question or definitions only cannot score high", () => {
  const dims = { relevance: 5, ownership: 4, correctness: 4, depth: 4 };
  assert.equal(cappedAnswerScore(4, dims, false), 4);
  assert.equal(cappedAnswerScore(4, dims, true), 2);
  assert.equal(cappedAnswerScore(4, { ...dims, relevance: 1 }, false), 1);
  assert.equal(cappedAnswerScore(3.6, null, false), 4);
});

function measured(overrides: Partial<AnswerMeasures> & { turnSeq: number }): AnswerMeasures {
  return {
    start: overrides.turnSeq * 60,
    end: overrides.turnSeq * 60 + 45,
    measuredFrames: 500,
    totalFrames: 600,
    quality: { brightness: 120, facePx: 140, sharpness: 80, measurable: 0.9, enhanced: 0 },
    atScreenShare: 0.85,
    multiFaceSeconds: 0,
    phoneSeconds: 0,
    extraPersonSeconds: 0,
    sampledSeconds: 45,
    lipSync: { correlation: 0.4, lag: 0, voicedFrames: 400 },
    voiceSimilarity: 0.75,
    delivery: {
      words: 110, spokenSeconds: 45, wordsPerMinute: 140, fillersPer100: 4, repeatsPer100: 3,
      longPauses: 3, pauseShare: 0.2, paceVariation: 0.5, startDelay: 1,
    },
    reading: { sweeps: 0, perMinute: 0, direction: null },
    ...overrides,
  };
}

function measures(answers: AnswerMeasures[], spots: VideoMeasures["spots"] = []): VideoMeasures {
  return {
    fps: 15,
    baseline: { frames: 900, source: "listening" },
    spots,
    answers,
    absences: [],
    quality: { brightness: 120, facePx: 140, sharpness: 80, measurable: 0.9, enhanced: 0 },
    faceSeen: true,
    checks: { audio: true, transcriber: true, voice: true, phone: true },
    partial: false,
    processingSeconds: 200,
  };
}

test("integrity: an ordinary honest interview is clear", () => {
  const findings = measuredFindings(measures([1, 2, 3, 4, 5, 6].map((turnSeq) => measured({ turnSeq }))));
  assert.deepEqual(findings, []);
  assert.equal(integrityLevel(findings), "clear");
});

test("integrity: one kind of evidence alone is at most review", () => {
  const answers = [1, 2, 3, 4, 5, 6].map((turnSeq) => measured({ turnSeq }));
  const spot = { id: 0, where: "below the screen", distance: 6, heldAnswers: [2, 3, 4, 5], listeningShare: 0.02 };
  const findings = measuredFindings(measures(answers, [spot]));
  assert.equal(findings[0].kind, "fixed_spot");
  assert.equal(integrityLevel(findings), "review");
});

test("integrity: a fixed spot plus read-aloud delivery on the same answers is high risk", () => {
  const smooth = {
    words: 120, spokenSeconds: 40, wordsPerMinute: 180, fillersPer100: 0, repeatsPer100: 0,
    longPauses: 0, pauseShare: 0.05, paceVariation: 0.2, startDelay: 0.3,
  };
  const answers = [1, 2, 3, 4, 5, 6].map((turnSeq) =>
    measured({ turnSeq, ...(turnSeq >= 3 ? { delivery: smooth } : {}) }),
  );
  const spot = { id: 0, where: "below the screen", distance: 6, heldAnswers: [3, 4, 5, 6], listeningShare: 0.02 };
  const findings = measuredFindings(measures(answers, [spot]));
  assert.ok(findings.some((finding) => finding.kind === "read_aloud"));
  assert.equal(integrityLevel(findings), "high_risk");
});

test("integrity: lip-sync is judged against the candidate's own other answers", () => {
  // A recording whose sound is out of step everywhere flags nothing.
  const allOff = [1, 2, 3, 4].map((turnSeq) => measured({ turnSeq, lipSync: { correlation: 0.01, lag: 0, voicedFrames: 400 } }));
  assert.equal(measuredFindings(measures(allOff)).length, 0);
  // One answer out of step, when the rest follow the voice, is worth a look.
  const oneOff = [1, 2, 3, 4].map((turnSeq) =>
    measured({ turnSeq, ...(turnSeq === 3 ? { lipSync: { correlation: 0.0, lag: 0, voicedFrames: 400 } } : {}) }),
  );
  const findings = measuredFindings(measures(oneOff));
  assert.deepEqual(findings.map((finding) => finding.kind), ["lip_sync"]);
  assert.deepEqual(findings[0].turnSeqs, [3]);
});

test("integrity: a different voice in two answers plus another face is high risk", () => {
  const answers = [1, 2, 3, 4, 5].map((turnSeq) =>
    measured({ turnSeq, ...(turnSeq >= 4 ? { voiceSimilarity: 0.1, multiFaceSeconds: 12 } : {}) }),
  );
  const findings = measuredFindings(measures(answers));
  assert.ok(findings.some((finding) => finding.kind === "voice_change" && finding.strength === 3));
  assert.equal(integrityLevel(findings), "high_risk");
});

test("integrity: a check that never ran is not shown as clean", () => {
  const check = buildIntegrityCheck({
    authenticity: { score: null, signals: [], status: "not_checked", reason: "thin", answers: [] },
    video: undefined,
    tab: { hiddenCount: 0, hiddenSeconds: 0 },
  });
  assert.equal(check.level, "not_checked");
});

test("integrity: while the video runs, a clean transcript reads as pending", () => {
  const check = buildIntegrityCheck({
    authenticity: { score: 100, signals: [], status: "checked", reason: null, answers: [] },
    video: { status: "queued", score: null, attentionPercent: null, moments: [], summary: "", model: null, reason: null },
    tab: { hiddenCount: 0, hiddenSeconds: 0 },
  });
  assert.equal(check.level, "pending");
  assert.equal(check.checks.camera, "running");
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

test("on-screen reading: steady reading everywhere, intro included, stays a soft note", () => {
  const answers = [1, 2, 3, 4, 5, 6].map((turnSeq) =>
    measured({ turnSeq, reading: { sweeps: 10, perMinute: 12, direction: 1 }, medianOffset: [-1.5, -2] }),
  );
  const findings = measuredFindings(measures(answers));
  assert.deepEqual(findings.map((f) => [f.kind, f.strength]), [["screen_reading", 1]]);
  assert.equal(integrityLevel(findings), "clear");
});

test("on-screen reading: one screen spot, quiet intro, plus pause-then-smooth delivery is high risk", () => {
  const smooth = {
    words: 120, spokenSeconds: 40, wordsPerMinute: 170, fillersPer100: 3, repeatsPer100: 0,
    longPauses: 0, pauseShare: 0.1, paceVariation: 0.3, startDelay: 0.2,
    firstContentDelay: 3.5, restDisfluencyPer100: 0.5,
  };
  const answers = [1, 2, 3, 4, 5, 6].map((turnSeq) =>
    turnSeq === 1
      ? measured({ turnSeq, reading: { sweeps: 1, perMinute: 2, direction: 1 }, medianOffset: [0.2, 0.1] })
      : measured({ turnSeq, reading: { sweeps: 10, perMinute: 12, direction: 1 }, medianOffset: [0.3, -2.2], delivery: smooth }),
  );
  const findings = measuredFindings(measures(answers));
  const kinds = findings.map((f) => f.kind);
  assert.ok(kinds.includes("screen_reading"));
  assert.ok(kinds.includes("stall_then_fluent"));
  assert.equal(integrityLevel(findings), "high_risk");
});

test("fixed spot: a still listener with a separate answering spot is caught (Gayathri, Oct 29)", () => {
  // Measured: listening spread is tiny (0.068 x 0.10), the answering spot sits
  // 2.66 spreads / 0.24 gaze units up and left, held in 14 of 21 answers, and
  // used for only 10% of listening time.
  const seqs = [2, 5, 7, 8, 11, 14, 17, 20, 22, 28, 32, 36, 42, 48, 13, 24, 34, 38, 44, 46, 49];
  const answers = seqs.map((turnSeq) => measured({ turnSeq }));
  const m = measures(answers, [
    { id: 0, x: -0.0545, y: -0.2328, where: "above and to the left of the screen", distance: 2.66, heldAnswers: seqs.slice(0, 14), listeningShare: 0.103 },
  ]);
  m.baseline = { frames: 835, source: "listening", x: 0.0614, y: -0.0261, sx: 0.0676, sy: 0.1017 };
  const findings = measuredFindings(m);
  const spot = findings.find((f) => f.kind === "fixed_spot");
  assert.ok(spot);
  assert.equal(spot.strength, 3);
  assert.equal(integrityLevel(findings), "review");
});

test("fixed spot: a tiny shift that is small in real terms is not flagged", () => {
  const seqs = [1, 2, 3, 4, 5, 6];
  const m = measures(seqs.map((turnSeq) => measured({ turnSeq })), [
    { id: 0, x: 0.1, y: 0.05, where: "below the screen", distance: 2.5, heldAnswers: [1, 2, 3, 4], listeningShare: 0.05 },
  ]);
  m.baseline = { frames: 900, source: "listening", x: 0.05, y: 0.0, sx: 0.03, sy: 0.03 };
  assert.equal(measuredFindings(m).filter((f) => f.kind === "fixed_spot").length, 0);
});
