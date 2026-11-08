import type {
  AnswerDimensions,
  AnswerGaze,
  AnswerMeasures,
  Authenticity,
  AuthenticitySignal,
  CheckState,
  IntegrityCheck,
  IntegrityFinding,
  IntegrityLevel,
  IntegritySource,
  CompetencyScore,
  CustomParameterScore,
  FactorId,
  GazePattern,
  OverallScore,
  ResumeClaim,
  VideoBehaviour,
  VideoMeasures,
  VideoMoment,
} from "./scorecard.types.ts";

/**
 * The arithmetic behind the scorecard. Models produce the observations
 * (scores per question, verdicts per resume claim, flagged moments); every
 * number shown to a recruiter is then computed here, in plain code, so the
 * same observations always give the same score and the rules can be read.
 *
 * No imports with side effects: this file is also run directly by the tests.
 */

/**
 * Percent of the score each factor carries. The score measures ability only:
 * how well the questions were answered, and whether the candidate could back
 * up their own resume in depth. Own answers and on-camera behaviour are
 * integrity checks (see buildIntegrityCheck): they never add points, because
 * an honest candidate who cannot do the job is still not a hire.
 */
export const DEFAULT_WEIGHTS: Record<FactorId, number> = {
  answers: 80,
  resume: 20,
  authenticity: 0,
  video: 0,
};

/** The factors that make up the score. */
export const FACTOR_ORDER: FactorId[] = ["answers", "resume"];

/**
 * Weights from an "80,20" (answers, resume) setting; falls back to the
 * defaults. An older four-part "45,20,20,15" setting keeps its first two
 * parts: integrity is never weighted into the score.
 */
export function parseWeights(setting: string | undefined): Record<FactorId, number> {
  const parts = (setting ?? "").split(",").map((part) => Number(part.trim()));
  if (
    (parts.length !== 2 && parts.length !== 4) ||
    parts.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return DEFAULT_WEIGHTS;
  }
  if (parts[0] + parts[1] <= 0) return DEFAULT_WEIGHTS;
  return { answers: parts[0], resume: parts[1], authenticity: 0, video: 0 };
}

/**
 * The answer score after the rules a grader cannot argue its way around:
 * an answer that misses the question scores no higher than its relevance, and
 * one that only recites definitions scores at most 2.
 */
export function cappedAnswerScore(
  score: number,
  dimensions: AnswerDimensions | null | undefined,
  definitionOnly: boolean,
): number {
  let capped = Math.max(1, Math.min(5, Math.round(score)));
  const relevance = dimensions?.relevance ?? null;
  if (relevance !== null && relevance <= 2) capped = Math.min(capped, Math.round(relevance));
  if (definitionOnly) capped = Math.min(capped, 2);
  return capped;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Answer quality, 0-100: the scored competencies (1-5 each) averaged by their
 * share of the interview plan. A 3, "meets the bar", is 60; a 5 is 100.
 */
export function answerQualityScore(
  competencies: readonly CompetencyScore[],
  planMinutes: ReadonlyMap<string, number>,
): number | null {
  let total = 0;
  let weight = 0;
  for (const item of competencies) {
    if (item.status !== "scored" || item.score === null) continue;
    const share = planMinutes.get(item.competencyId) ?? 1;
    total += item.score * share;
    weight += share;
  }
  return weight === 0 ? null : clampScore((total / weight / 5) * 100);
}

/**
 * Custom parameter total, 0-100: the weighted mean of the parameters that
 * could be scored. A parameter weighted 0 does not drag the total down; when
 * every weight is 0 the scored parameters count equally. Parameters with no
 * evidence are left out rather than counted as zero.
 */
export function customScore(parameters: readonly CustomParameterScore[]): number | null {
  const scored = parameters.filter(
    (item) => item.status === "scored" && item.score !== null,
  );
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (totalWeight === 0) {
    const mean = scored.reduce((sum, item) => sum + (item.score as number), 0) / scored.length;
    return clampScore(mean);
  }
  const total = scored.reduce(
    (sum, item) => sum + (item.score as number) * Math.max(0, item.weight),
    0,
  );
  return clampScore(total / totalWeight);
}

const CLAIM_CREDIT = { confirmed: 1, partly_supported: 0.5, not_supported: 0 } as const;

/** Fewer checked claims than this cannot support a resume-match score. */
export const MIN_CLAIMS_FOR_SCORE = 2;

/**
 * Resume match, 0-100: of the resume claims the interview actually got to,
 * how many the candidate's own account backed up. Claims that were never
 * discussed do not count for or against.
 */
export function resumeMatchScore(claims: readonly ResumeClaim[]): number | null {
  const checked = claims.filter((claim) => claim.verdict !== "not_discussed");
  if (checked.length < MIN_CLAIMS_FOR_SCORE) return null;
  const credit = checked.reduce(
    (sum, claim) => sum + CLAIM_CREDIT[claim.verdict as keyof typeof CLAIM_CREDIT],
    0,
  );
  return clampScore((credit / checked.length) * 100);
}

const SIGNAL_PENALTY = { 1: 6, 2: 14, 3: 26 } as const;

/**
 * Own answers, 0-100: starts at 100 and loses points for each signal that an
 * answer was read out or prompted. No signals means 100, not "proven honest";
 * a check that did not run has no score at all (see buildAuthenticity).
 */
export function authenticityScore(signals: readonly AuthenticitySignal[]): number {
  const lost = signals.reduce(
    (sum, signal) => sum + (signal.penalty ?? SIGNAL_PENALTY[signal.severity]),
    0,
  );
  return clampScore(100 - lost);
}

const MOMENT_PENALTY: Record<VideoMoment["kind"], number> = {
  looking_away: 5,
  reading: 12,
  other_person: 28,
  second_device: 20,
  left_frame: 8,
  other: 4,
};

/** Answers shorter than this say too little about where someone looks. */
export const MIN_GAZE_ANSWER_SECONDS = 4;
/** Below this many judged answers there is no pattern to speak of. */
export const MIN_ANSWERS_FOR_PATTERN = 3;

function mostCommon<T>(values: readonly T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * The pattern across answers. The candidate's usual direction while
 * listening is taken as the interview window; an answer counts towards the
 * pattern only when the eyes were held steadily somewhere else. What matters
 * is how many answers share the same such spot.
 */
export function gazePattern(answers: readonly AnswerGaze[]): GazePattern {
  const judged = answers.filter(
    (answer) =>
      answer.durationSeconds >= MIN_GAZE_ANSWER_SECONDS && answer.whileAnswering !== "unclear",
  );
  const listening = mostCommon(
    answers.map((answer) => answer.whileListening).filter((direction) => direction !== "unclear"),
  );
  const listeningDirection = listening?.value ?? null;
  const offScreen = judged.filter(
    (answer) =>
      answer.steady &&
      answer.whileAnswering !== (listeningDirection ?? "centre") &&
      // Without a listening baseline, straight ahead is taken as the screen.
      answer.whileAnswering !== "centre",
  );
  const spot = mostCommon(offScreen.map((answer) => answer.whileAnswering));
  return {
    answersObserved: judged.length,
    listeningDirection,
    direction: spot?.value ?? null,
    sameSpotAnswers: spot?.count ?? 0,
    readingAnswers: judged.filter((answer) => answer.reading).length,
  };
}

/**
 * On-camera behaviour, 0-100: starts at 100 and loses points for
 * - the share of answers given while looking at one same spot off the screen
 *   (the main signal: up to 60 points when it is every answer),
 * - answers with reading-like eye movement,
 * - other flagged moments (another person, a second device, leaving the picture),
 * - time spent outside the interview tab.
 * A single look away costs little or nothing; a repeated pattern adds up.
 */
export function videoBehaviourScore(
  moments: readonly VideoMoment[],
  tab: { hiddenCount: number; hiddenSeconds: number },
  pattern: GazePattern | null = null,
): number {
  let lost = 0;
  for (const moment of moments) {
    lost += MOMENT_PENALTY[moment.kind] + Math.min(6, moment.durationSeconds / 10);
  }
  if (pattern && pattern.answersObserved >= MIN_ANSWERS_FOR_PATTERN) {
    // Two answers on the same spot can be chance; from there it scales.
    if (pattern.sameSpotAnswers >= 2) {
      lost += 60 * (pattern.sameSpotAnswers / pattern.answersObserved);
    }
    lost += Math.min(30, pattern.readingAnswers * 10);
  }
  lost += Math.min(30, tab.hiddenCount * 4 + tab.hiddenSeconds / 6);
  return clampScore(100 - lost);
}

/**
 * Overall, 0-100: the weighted average of the factors that have a score.
 * Missing factors are left out and the remaining weights carry the total.
 */
export function overallScore(
  scores: Record<FactorId, number | null>,
  weights: Record<FactorId, number> = DEFAULT_WEIGHTS,
): OverallScore {
  const factors = FACTOR_ORDER.map((id) => ({ id, score: scores[id], weight: weights[id] }));
  // Integrity factors are never part of the total, whatever weights are passed.
  // Without scored answers there is nothing to anchor a total on.
  if (scores.answers === null) return { score: null, factors };

  let total = 0;
  let weight = 0;
  for (const factor of factors) {
    if (factor.score === null || factor.weight <= 0) continue;
    total += factor.score * factor.weight;
    weight += factor.weight;
  }
  return { score: weight === 0 ? null : clampScore(total / weight), factors };
}

export interface TimedAnswer {
  seq: number;
  responseLatencyMs: number | null;
  durationMs: number | null;
  wordCount: number;
}

/**
 * Signals that need no judgement, only the recorded timings: a long,
 * structured answer that began almost at once, when the same candidate
 * normally pauses before answering.
 */
export function measuredAuthenticitySignals(answers: readonly TimedAnswer[]): AuthenticitySignal[] {
  const latencies = answers
    .map((answer) => answer.responseLatencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (latencies.length < 4) return [];
  const usual = latencies[Math.floor(latencies.length / 2)];

  const signals: AuthenticitySignal[] = [];

  const instant = answers.filter(
    (answer) =>
      answer.responseLatencyMs !== null &&
      answer.responseLatencyMs < 500 &&
      answer.responseLatencyMs < usual / 3 &&
      answer.wordCount >= 90,
  );
  if (instant.length > 0) {
    signals.push({
      title:
        instant.length === 1
          ? "A long answer started almost instantly"
          : `${instant.length} long answers started almost instantly`,
      detail: `The candidate usually paused about ${(usual / 1000).toFixed(1)} s before answering, but ${
        instant.length === 1 ? "this answer" : "these answers"
      } of 90 words or more began within half a second.`,
      turnSeqs: instant.map((answer) => answer.seq),
      severity: instant.length >= 3 ? 3 : instant.length === 2 ? 2 : 1,
      source: "measured",
    });
  }

  // Reading aloud runs faster and more evenly than thinking aloud. A long
  // answer that starts at once and keeps a reading pace is worth a look; the
  // threshold is high enough that a fast talker alone does not trip it.
  const readingPace = answers.filter((answer) => {
    if (answer.wordCount < 90 || !answer.durationMs || answer.durationMs <= 0) return false;
    const wordsPerSecond = answer.wordCount / (answer.durationMs / 1000);
    const startedAtOnce =
      answer.responseLatencyMs === null || answer.responseLatencyMs < 800;
    return wordsPerSecond >= 3.6 && startedAtOnce;
  });
  if (readingPace.length > 0) {
    const fastest = Math.max(
      ...readingPace.map((answer) => answer.wordCount / ((answer.durationMs as number) / 1000)),
    );
    signals.push({
      title:
        readingPace.length === 1
          ? "A long answer was delivered at reading pace"
          : `${readingPace.length} long answers were delivered at reading pace`,
      detail: `${
        readingPace.length === 1 ? "This answer" : "These answers"
      } of 90 words or more ran at up to ${fastest.toFixed(1)} words per second and started within a second, which is faster and steadier than thinking aloud usually sounds.`,
      turnSeqs: readingPace.map((answer) => answer.seq),
      severity: readingPace.length >= 3 ? 3 : 2,
      source: "measured",
    });
  }

  return signals;
}

// --- integrity ---------------------------------------------------------------

/**
 * How far a spot must be from where the candidate looks while listening:
 * in their own gaze spreads, and in raw gaze units (about 5-6 degrees). Both,
 * because a candidate who sits very still while listening has a tiny spread,
 * which makes small, honest shifts look far in relative terms only.
 */
const MIN_SPOT_DISTANCE = 2;
const MIN_SPOT_OFFSET = 0.15;
/** Upper bound of the "on the screen" band used by the on-screen reading check. */
const SCREEN_BAND = 4;

/** Answers this long or shorter say too little to judge their delivery. */
const MIN_DELIVERY_WORDS = 60;

function seconds(value: number): number {
  return Math.max(0, Math.round(value));
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Findings from the calibrated video and audio measurements. Each rule is
 * relative to the candidate where it can be: their own screen position, their
 * own usual hesitations, their own voice in the other answers. That keeps a
 * nervous or fast-talking candidate from being flagged for being themselves.
 */
export function measuredFindings(measures: VideoMeasures): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const answers = measures.answers;
  const judged = answers.filter((answer) => answer.atScreenShare !== null);
  const byTurn = new Map(answers.map((answer) => [answer.turnSeq, answer]));
  const startOf = (seqs: number[]) => {
    const first = seqs.map((seq) => byTurn.get(seq)?.start).filter((v): v is number => v !== undefined);
    return first.length ? seconds(Math.min(...first)) : null;
  };

  // 1. The same spot off the screen, answer after answer, and not while listening.
  const spot = measures.spots[0];
  if (spot && judged.length >= MIN_ANSWERS_FOR_PATTERN) {
    const held = spot.heldAnswers.filter((seq) => byTurn.get(seq)?.atScreenShare !== null);
    const share = held.length / judged.length;
    // What matters is not whether the spot is past the screen's edge (a
    // copilot overlay sits ON the screen), but that it is a separate place the
    // candidate goes to while answering and hardly uses while listening.
    const base = measures.baseline;
    const rawOffset =
      spot.x !== undefined && spot.y !== undefined && base.x !== undefined && base.y !== undefined
        ? Math.hypot(spot.x - base.x, spot.y - base.y)
        : null;
    const separate = spot.distance >= MIN_SPOT_DISTANCE && (rawOffset === null || rawOffset >= MIN_SPOT_OFFSET);
    if (held.length >= 2 && spot.listeningShare < 0.15 && separate) {
      const strength: 1 | 2 | 3 = held.length >= 3 && share >= 0.5 ? 3 : held.length >= 3 && share >= 0.25 ? 2 : 1;
      findings.push({
        kind: "fixed_spot",
        source: "video",
        strength,
        title: `Eyes held on one spot ${spot.where} in ${held.length} of ${judged.length} answers`,
        detail: `While answering, the candidate kept going back to the same place ${spot.where}, and hardly looked there while listening (${Math.round(spot.listeningShare * 100)}% of listening time). That is how notes, a phone, a second screen or an on-screen AI tool looks on camera. Looking away to think is different: it wanders and changes from answer to answer.`,
        turnSeqs: held,
        atSeconds: startOf(held),
      });
    }
  }

  // 2. Line-by-line reading in the eye track. Judged against the candidate's
  // own rate across answers: some people's eyes move like this whenever they
  // talk, or they glance back at the question on screen. An answer stands out
  // only when it has far more of it than their usual.
  const rates = judged.map((answer) => answer.reading?.perMinute ?? 0);
  const usualRate = median(rates) ?? 0;
  const reads = (answer: AnswerMeasures) =>
    (answer.reading?.sweeps ?? 0) >= 4 && (answer.reading?.perMinute ?? 0) >= 6;
  const reading = judged.filter(
    (answer) => reads(answer) && (answer.reading?.perMinute ?? 0) >= 2.5 * usualRate,
  );
  if (reading.length > 0) {
    const seqs = reading.map((answer) => answer.turnSeq);
    findings.push({
      kind: "reading_eyes",
      source: "video",
      strength: reading.length >= 2 ? 2 : 1,
      title: `Eyes moved line by line, as in reading, in ${plural(reading.length, "answer")}`,
      detail:
        "The eyes drifted slowly sideways and then jumped back, again and again, the way they move across lines of text, far more than in the candidate's other answers. Watch these answers to see whether the candidate was reading.",
      turnSeqs: seqs,
      atSeconds: startOf(seqs),
    });
  }

  // 2b. Reading while looking AT the screen. On-screen AI tools (Parakeet,
  // Cluely and similar) show the answer in an overlay that screen sharing
  // cannot see, so the candidate never looks away: the tell is reading-like
  // eye movement during most answers, at one steady place on the screen that
  // differs from where they look while listening, and much less of it in
  // their unscripted introduction. On its own this stays a soft signal: the
  // call screen also shows the question text, which honest candidates re-read.
  if (judged.length >= MIN_ANSWERS_FOR_PATTERN) {
    const readers = judged.filter(reads);
    const intro = judged[0];
    const introRate = intro?.reading?.perMinute ?? null;
    const readerRate = median(readers.map((answer) => answer.reading?.perMinute ?? 0)) ?? 0;
    // A steady on-screen place: answers whose median gaze sits 1.2-4 spreads from
    // the listening centre, all in the same direction.
    const placed = readers.filter((answer) => {
      const offset = answer.medianOffset;
      if (!offset) return false;
      const distance = Math.hypot(offset[0], offset[1]);
      return distance >= 1.2 && distance < SCREEN_BAND;
    });
    const angles = placed.map((answer) => Math.atan2((answer.medianOffset as number[])[1], (answer.medianOffset as number[])[0]));
    const meanAngle = Math.atan2(
      angles.reduce((sum, a) => sum + Math.sin(a), 0),
      angles.reduce((sum, a) => sum + Math.cos(a), 0),
    );
    const samePlace = placed.filter((_, i) => Math.abs(Math.atan2(Math.sin(angles[i] - meanAngle), Math.cos(angles[i] - meanAngle))) <= Math.PI / 4);
    const most = readers.length >= Math.max(3, 0.5 * judged.length);
    const introQuiet = introRate !== null && readerRate > 0 && introRate <= 0.5 * readerRate && !reads(intro);
    const alreadyFlagged = new Set(reading.map((answer) => answer.turnSeq));
    if (most && (samePlace.length >= Math.max(3, 0.4 * judged.length) || introQuiet)) {
      const seqs = (samePlace.length >= 3 ? samePlace : readers)
        .map((answer) => answer.turnSeq)
        .filter((seq) => !alreadyFlagged.has(seq));
      if (seqs.length > 0) {
        findings.push({
          kind: "screen_reading",
          source: "video",
          strength: samePlace.length >= 3 && introQuiet ? 2 : 1,
          title: `Reading-like eye movement while looking at the screen in ${plural(readers.length, "answer")}`,
          detail: `${
            samePlace.length >= 3 ? "The eyes kept going to the same part of the screen and moved across it line by line" : "The eyes moved across the screen line by line"
          }${introQuiet ? ", much more than in the candidate's own introduction" : ""}. That is how reading an answer from an on-screen AI tool looks, though it can also be the candidate re-reading the question shown on the call screen. Check whether the delivery sounds read.`,
          turnSeqs: seqs,
          atSeconds: startOf(seqs),
        });
      }
    }
  }

  // 3. Lip-sync: mouth movement that does not follow the voice. Judged against
  // the candidate's own other answers, so a recording whose sound is slightly
  // out of step with its picture does not flag everything.
  const synced = answers.filter(
    (answer) =>
      answer.lipSync?.correlation !== null &&
      answer.lipSync?.correlation !== undefined &&
      (answer.lipSync?.voicedFrames ?? 0) >= 150 &&
      (answer.quality.facePx ?? 0) >= 90 &&
      answer.quality.measurable >= 0.6,
  );
  const usual = median(synced.map((answer) => answer.lipSync?.correlation as number));
  if (usual !== null && usual >= 0.2 && synced.length >= MIN_ANSWERS_FOR_PATTERN) {
    const off = synced.filter((answer) => (answer.lipSync?.correlation as number) < 0.05);
    if (off.length > 0) {
      const seqs = off.map((answer) => answer.turnSeq);
      findings.push({
        kind: "lip_sync",
        source: "video",
        strength: off.length >= 2 ? 2 : 1,
        title: `Mouth did not move with the voice in ${plural(off.length, "answer")}`,
        detail: `In the rest of the interview the candidate's lips follow their voice closely; here they do not. Someone else may have been speaking, or the candidate may have been mouthing along. Watch with sound on.`,
        turnSeqs: seqs,
        atSeconds: startOf(seqs),
      });
    }
  }

  // 4. A different voice from the candidate's usual one.
  const voiced = answers.filter(
    (answer) => answer.voiceSimilarity !== null && answer.voiceSimilarity !== undefined && (answer.delivery?.words ?? 0) >= 25,
  );
  const usualVoice = median(voiced.map((answer) => answer.voiceSimilarity as number));
  if (usualVoice !== null && voiced.length >= MIN_ANSWERS_FOR_PATTERN) {
    const strongCut = Math.min(0.35, usualVoice - 0.3);
    const weakCut = Math.min(0.5, usualVoice - 0.2);
    const changed = voiced.filter((answer) => (answer.voiceSimilarity as number) < weakCut);
    if (changed.length > 0) {
      const seqs = changed.map((answer) => answer.turnSeq);
      const strong = changed.some((answer) => (answer.voiceSimilarity as number) < strongCut);
      findings.push({
        kind: "voice_change",
        source: "audio",
        strength: strong ? 3 : 2,
        title: `A different-sounding voice in ${plural(changed.length, "answer")}`,
        detail:
          "The voice in these answers does not match the candidate's voice in the rest of the interview. Listen for a second person answering.",
        turnSeqs: seqs,
        atSeconds: startOf(seqs),
      });
    }
  }

  // 5. Another face, another person, a phone in the picture.
  const faces = answers.filter((answer) => answer.multiFaceSeconds >= 3 || (answer.extraPersonSeconds ?? 0) >= 3);
  if (faces.length > 0) {
    const total = faces.reduce((sum, answer) => sum + Math.max(answer.multiFaceSeconds, answer.extraPersonSeconds ?? 0), 0);
    const seqs = faces.map((answer) => answer.turnSeq);
    findings.push({
      kind: "second_face",
      source: "video",
      strength: total >= 10 ? 3 : 2,
      title: `Another person in the picture during ${plural(faces.length, "answer")}`,
      detail: `A second face or person was visible for about ${total} seconds while the candidate was answering.`,
      turnSeqs: seqs,
      atSeconds: startOf(seqs),
    });
  }
  const phones = answers.filter((answer) => (answer.phoneSeconds ?? 0) >= 2);
  if (phones.length > 0) {
    const total = phones.reduce((sum, answer) => sum + (answer.phoneSeconds ?? 0), 0);
    const seqs = phones.map((answer) => answer.turnSeq);
    findings.push({
      kind: "phone",
      source: "video",
      strength: total >= 6 ? 3 : 2,
      title: `A phone was visible during ${plural(phones.length, "answer")}`,
      detail: `A phone showed in the picture for about ${total} seconds while the candidate was answering.`,
      turnSeqs: seqs,
      atSeconds: startOf(seqs),
    });
  }

  // 6. Read-aloud delivery: an answer much smoother than this candidate's own
  // way of speaking (no hesitations, no restarts, an even pace).
  const spoken = answers.filter((answer) => (answer.delivery?.words ?? 0) >= 40);
  // The candidate's natural way of speaking: their introduction (the first
  // answer, never scripted) or their more hesitant answers, whichever shows
  // more. A median would sink to zero if most answers were read out.
  const disfluencies = spoken.map(
    (answer) => (answer.delivery?.fillersPer100 ?? 0) + (answer.delivery?.repeatsPer100 ?? 0),
  );
  const sortedDisfluency = [...disfluencies].sort((a, b) => a - b);
  const upperQuartile = sortedDisfluency.length
    ? sortedDisfluency[Math.floor(0.75 * (sortedDisfluency.length - 1))]
    : null;
  const intro = spoken[0] ? disfluencies[0] : null;
  const usualDisfluency =
    upperQuartile === null ? null : Math.max(upperQuartile, intro ?? 0);
  if (usualDisfluency !== null && usualDisfluency >= 2 && spoken.length >= MIN_ANSWERS_FOR_PATTERN) {
    const smooth = spoken.filter((answer) => {
      const d = answer.delivery;
      if (!d || d.words < MIN_DELIVERY_WORDS) return false;
      const disfluency = d.fillersPer100 + d.repeatsPer100;
      return disfluency <= 0.25 * usualDisfluency && d.longPauses <= 1;
    });
    if (smooth.length > 0) {
      const steady = smooth.filter((answer) => (answer.delivery?.paceVariation ?? 1) <= 0.35);
      const seqs = smooth.map((answer) => answer.turnSeq);
      findings.push({
        kind: "read_aloud",
        source: "audio",
        strength: steady.length >= 2 ? 2 : 1,
        title: `${plural(smooth.length, "answer")} sounded read out`,
        detail: `This candidate usually hesitates or restarts about ${usualDisfluency.toFixed(1)} times per 100 words. ${smooth.length === 1 ? "This answer was" : "These answers were"} almost free of that${steady.length > 0 ? ", at an unusually even pace" : ""}, which is how reading aloud sounds.`,
        turnSeqs: seqs,
        atSeconds: startOf(seqs),
      });
    }
  }

  // 6b. The copilot timing: a stall (silence, or "so... umm...") while the tool
  // writes, then delivery far smoother than the candidate's own usual.
  if (usualDisfluency !== null && usualDisfluency >= 2 && spoken.length >= MIN_ANSWERS_FOR_PATTERN) {
    const stalled = spoken.filter((answer) => {
      const d = answer.delivery;
      if (!d || d.restDisfluencyPer100 === null || d.restDisfluencyPer100 === undefined) return false;
      return (d.firstContentDelay ?? 0) >= 2.5 && d.restDisfluencyPer100 <= 0.35 * usualDisfluency;
    });
    if (stalled.length >= 2) {
      const seqs = stalled.map((answer) => answer.turnSeq);
      findings.push({
        kind: "stall_then_fluent",
        source: "audio",
        strength: stalled.length >= 3 ? 2 : 1,
        title: `Waited, then answered unusually smoothly, in ${plural(stalled.length, "answer")}`,
        detail:
          "Each of these answers opened with a pause or filler words, and then ran far more smoothly than this candidate normally speaks. That is the rhythm of waiting for an AI tool to write an answer and then reading it.",
        turnSeqs: seqs,
        atSeconds: startOf(seqs),
      });
    }
  }

  // 7. Out of the picture for a while.
  const away = measures.absences.filter((item) => item.durationSeconds >= 10);
  if (away.length > 0) {
    const total = away.reduce((sum, item) => sum + item.durationSeconds, 0);
    findings.push({
      kind: "left_frame",
      source: "video",
      strength: total >= 60 ? 2 : 1,
      title: `Out of the picture ${away.length === 1 ? "once" : `${away.length} times`}`,
      detail: `No face could be seen for about ${seconds(total)} seconds in total.`,
      turnSeqs: [],
      atSeconds: seconds(away[0].atSeconds),
    });
  }
  return findings;
}

/** Findings from the transcript check and the measured live timings. */
export function textFindings(authenticity: Authenticity | undefined): IntegrityFinding[] {
  if (!authenticity || authenticity.status === "not_checked") return [];
  const findings: IntegrityFinding[] = [];
  const read = (authenticity.answers ?? []).filter((item) => item.verdict === "likely_read");
  const polished = (authenticity.answers ?? []).filter((item) => item.verdict === "polished");
  if (read.length > 0) {
    findings.push({
      kind: "scripted_text",
      source: "text",
      strength: read.length >= 2 ? 2 : 1,
      title: `${plural(read.length, "answer")} read like a textbook or AI answer`,
      detail: read.flatMap((item) => item.reasons).slice(0, 2).join(" ") ||
        "The wording is far more polished and generic than how the candidate speaks elsewhere.",
      turnSeqs: read.map((item) => item.turnSeq),
      atSeconds: null,
    });
  } else if (polished.length >= 2) {
    findings.push({
      kind: "scripted_text",
      source: "text",
      strength: 1,
      title: `${plural(polished.length, "answer")} more polished than the candidate's usual way of speaking`,
      detail: polished.flatMap((item) => item.reasons).slice(0, 2).join(" "),
      turnSeqs: polished.map((item) => item.turnSeq),
      atSeconds: null,
    });
  }
  for (const signal of authenticity.signals) {
    if (signal.title.startsWith("Left the interview tab")) continue;
    findings.push({
      kind: signal.source === "measured" ? "read_aloud" : "scripted_text",
      source: signal.source === "measured" ? "audio" : "text",
      strength: Math.min(signal.severity, 2) as 1 | 2,
      title: signal.title,
      detail: signal.detail,
      turnSeqs: signal.turnSeqs,
      atSeconds: null,
    });
  }
  return findings;
}

export function browserFindings(tab: { hiddenCount: number; hiddenSeconds: number }): IntegrityFinding[] {
  if (tab.hiddenCount <= 0) return [];
  return [
    {
      kind: "left_tab",
      source: "browser",
      strength: tab.hiddenCount >= 4 || tab.hiddenSeconds >= 60 ? 2 : 1,
      title: `Left the interview tab ${tab.hiddenCount === 1 ? "once" : `${tab.hiddenCount} times`}`,
      detail: `The interview page was in the background for ${tab.hiddenSeconds} seconds in total.`,
      turnSeqs: [],
      atSeconds: null,
    },
  ];
}

/**
 * The integrity level, from all findings. One kind of evidence on its own is
 * at most "review": people look away, speak smoothly, or sit in dim rooms for
 * honest reasons. "High risk" needs two different sources (eyes and voice,
 * say) agreeing on the same answers, or a hard sign such as another person.
 */
export function integrityLevel(findings: readonly IntegrityFinding[]): Exclude<IntegrityLevel, "pending" | "not_checked"> {
  const sourcesByTurn = new Map<number, Set<IntegritySource>>();
  for (const finding of findings) {
    if (finding.strength < 2) continue;
    for (const seq of finding.turnSeqs) {
      const set = sourcesByTurn.get(seq) ?? new Set<IntegritySource>();
      set.add(finding.source);
      sourcesByTurn.set(seq, set);
    }
  }
  const agreed = [...sourcesByTurn.values()].filter((set) => set.size >= 2).length;
  const hard = findings.filter(
    (finding) =>
      finding.strength === 3 && (finding.kind === "voice_change" || finding.kind === "second_face" || finding.kind === "phone"),
  );
  const hardKinds = new Set(hard.map((finding) => finding.kind)).size;
  if (agreed >= 2 || (agreed >= 1 && hard.length > 0) || hardKinds >= 2) return "high_risk";
  const notable = findings.filter((finding) => finding.strength >= 2);
  const glanceKinds = new Set(findings.map((finding) => finding.kind)).size;
  if (notable.length > 0 || glanceKinds >= 2) return "review";
  return "clear";
}

/** What limited the checks, in plain words. */
export function checkLimits(measures: VideoMeasures | null | undefined): string[] {
  if (!measures) return [];
  const limits: string[] = [];
  const answers = measures.answers;
  const unreadable = answers.filter((answer) => answer.atScreenShare === null && answer.end - answer.start >= 4);
  if (unreadable.length > 0 && answers.length > 0) {
    const dark = measures.quality.brightness !== null && measures.quality.brightness < 70;
    limits.push(
      `${unreadable.length} of ${answers.length} answers could not be read on camera${dark ? ", mostly because the room was dark" : ""}.`,
    );
  }
  if (measures.quality.enhanced >= 0.3) {
    limits.push("The picture was dim, so frames were brightened and cleaned up before measuring. Eye readings are less precise.");
  }
  if (measures.quality.facePx !== null && measures.quality.facePx < 90) {
    limits.push("The face was small in the picture, which limits how precisely the eyes and lips can be read.");
  }
  if (!measures.checks.audio) limits.push("The recording has no usable sound, so voice and lip-sync checks did not run.");
  else if (!measures.checks.transcriber) limits.push("The speech check was unavailable, so read-aloud delivery was not measured.");
  if (measures.checks.audio && !measures.checks.voice) limits.push("The voice check was unavailable on the analysis server.");
  if (measures.partial) limits.push("Part of the recording could not be analysed; the result covers the rest.");
  return limits;
}

const LEVEL_WORDS: Record<IntegrityLevel, string> = {
  clear: "Nothing stood out",
  review: "Worth a look before deciding",
  high_risk: "High risk: watch before deciding",
  pending: "Still checking the video and audio",
  not_checked: "Not checked",
};

/** A plain summary written in code, used when the model is unavailable. */
export function integritySummary(check: Omit<IntegrityCheck, "summary" | "summaryBy">): string {
  if (check.level === "not_checked") {
    return "The integrity checks could not run for this interview, so there is no reading either way.";
  }
  const top = [...check.findings].sort((a, b) => b.strength - a.strength).slice(0, 2);
  const parts: string[] = [];
  if (top.length === 0) {
    parts.push(
      check.level === "pending"
        ? "The transcript check found nothing unusual. The video and audio checks are still running."
        : "The answers sound like the candidate's own, and nothing in the video or audio stood out.",
    );
  } else {
    parts.push(`${LEVEL_WORDS[check.level]}. ${top.map((finding) => finding.title).join("; ")}.`);
    if (check.level === "pending") parts.push("The video and audio checks are still running.");
  }
  if (check.limits.length > 0) parts.push(check.limits[0]);
  return parts.join(" ");
}

/** Combines every source into the integrity section of the report. */
export function buildIntegrityCheck(input: {
  authenticity: Authenticity | undefined;
  video: VideoBehaviour | undefined;
  tab: { hiddenCount: number; hiddenSeconds: number };
}): Omit<IntegrityCheck, "summary" | "summaryBy"> {
  const { authenticity, video, tab } = input;
  const measures = video?.version === 2 ? (video.measures ?? null) : null;
  const findings = [
    ...textFindings(authenticity),
    ...(measures ? measuredFindings(measures) : []),
    ...browserFindings(tab),
  ];
  const videoState: CheckState =
    video?.status === "queued"
      ? "running"
      : video?.status === "analysed" && measures
        ? "done"
        : video?.status === "no_recording" || video?.status === "not_configured"
          ? "unavailable"
          : "not_run";
  const checks: IntegrityCheck["checks"] = {
    ownAnswers: authenticity && authenticity.status !== "not_checked" ? "done" : "not_run",
    camera: videoState,
    voice:
      videoState === "done"
        ? measures?.checks.voice && measures.checks.audio
          ? "done"
          : "unavailable"
        : videoState,
    lipSync: videoState === "done" ? (measures?.checks.audio ? "done" : "unavailable") : videoState,
    browser: "done",
  };
  const anyRan = checks.ownAnswers === "done" || checks.camera === "done";
  let level: IntegrityLevel = integrityLevel(findings);
  if (level !== "high_risk") {
    if (checks.camera === "running" && level === "clear") level = "pending";
    else if (!anyRan && checks.camera !== "running" && findings.length === 0) level = "not_checked";
  }
  return { level, findings, checks, limits: checkLimits(measures) };
}

/** On-camera numbers for the v2 analysis, shown in the On camera card. */
export function measuredVideoScore(findings: readonly IntegrityFinding[]): number {
  const lost = findings
    .filter((finding) => finding.source === "video")
    .reduce((sum, finding) => sum + finding.strength * 12, 0);
  return clampScore(100 - lost);
}

export function medianAtScreen(answers: readonly AnswerMeasures[]): number | null {
  const shares = answers.map((answer) => answer.atScreenShare).filter((v): v is number => v !== null && v !== undefined);
  const value = median(shares);
  return value === null ? null : Math.round(value * 100);
}
