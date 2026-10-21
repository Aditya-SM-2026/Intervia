/**
 * Derived report insights: the HR-oriented numbers and verdict bands that the
 * scorecard alone does not carry. Everything here is computed from data the
 * platform already stores — no model calls, safe to add to old scorecards.
 */

import type { InterviewRoom, InterviewTurn } from "./interview.types";
import type { PeerSummary, Scorecard } from "./scorecard.types";

export type HireBand = "strong-hire" | "hire" | "no-hire" | "strong-no-hire" | "insufficient";

export interface ReportInsights {
  hireBand: { band: HireBand; label: string; basis: string };
  talk: {
    candidateSeconds: number;
    interviewerSeconds: number;
    candidatePercent: number | null;
  };
  speaking: {
    answers: number;
    medianAnswerSeconds: number | null;
    longestAnswerSeconds: number | null;
    medianLatencyMs: number | null;
    candidateQuestions: number;
    medianAnswerWords: number | null;
  };
  questionStats: Map<
    string,
    { answerSeconds: number; turns: number; latencyMs: number | null; words: number | null }
  >;
  redFlags: { level: "low" | "medium" | "high"; items: string[] };
  nextSteps: string[];
  coverage: { planned: number; scored: number; skipped: number };
  benchmark: { peers: number; average: number | null; label: string | null };
}

const HIRE_LABELS: Record<HireBand, string> = {
  "strong-hire": "Strong hire",
  hire: "Hire",
  "no-hire": "No hire",
  "strong-no-hire": "Strong no hire",
  insufficient: "Insufficient evidence",
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function turnSeconds(turn: InterviewTurn): number {
  if (!turn.startedAt || !turn.endedAt) return 0;
  const seconds = (Date.parse(turn.endedAt) - Date.parse(turn.startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function turnWords(turn: InterviewTurn): number {
  return turn.text.split(/\s+/).filter(Boolean).length;
}

export function buildReportInsights(input: {
  session: InterviewRoom;
  scorecard: Scorecard;
  turns: InterviewTurn[];
  peers: PeerSummary[];
}): ReportInsights {
  const { session, scorecard, turns, peers } = input;

  // --- hiring band ---------------------------------------------------------
  const score = scorecard.overall?.score ?? null;
  let band: HireBand;
  if (score === null || scorecard.suggestion === "insufficient") {
    band = "insufficient";
  } else if (score >= 75) {
    band = "strong-hire";
  } else if (score >= 60) {
    band = "hire";
  } else if (score >= 45) {
    band = "no-hire";
  } else {
    band = "strong-no-hire";
  }
  const hireBand = {
    band,
    label: HIRE_LABELS[band],
    basis:
      score === null
        ? "Not enough scored answers for a verdict."
        : `From the overall score of ${score} of 100. The final call stays with you.`,
  };

  // --- talk ratio ----------------------------------------------------------
  let candidateSeconds = 0;
  let interviewerSeconds = 0;
  for (const turn of turns) {
    const seconds = turnSeconds(turn);
    if (turn.speaker === "candidate") candidateSeconds += seconds;
    else interviewerSeconds += seconds;
  }
  const totalSpeech = candidateSeconds + interviewerSeconds;
  const talk = {
    candidateSeconds,
    interviewerSeconds,
    candidatePercent: totalSpeech > 0 ? Math.round((candidateSeconds / totalSpeech) * 100) : null,
  };

  // --- speaking ------------------------------------------------------------
  const candidateTurns = turns.filter((turn) => turn.speaker === "candidate");
  const answerSeconds = candidateTurns.map(turnSeconds).filter((seconds) => seconds > 0);
  const latencies = candidateTurns
    .map((turn) => turn.responseLatencyMs)
    .filter((value): value is number => value !== null);
  const speaking = {
    answers: candidateTurns.length,
    medianAnswerSeconds: median(answerSeconds),
    longestAnswerSeconds: answerSeconds.length > 0 ? Math.max(...answerSeconds) : null,
    medianLatencyMs: median(latencies),
    candidateQuestions: candidateTurns.filter((turn) => turn.text.includes("?")).length,
    medianAnswerWords: median(candidateTurns.map(turnWords).filter((words) => words > 0)),
  };

  // --- per-question (per competency) stats ---------------------------------
  const questionStats = new Map<
    string,
    { answerSeconds: number; turns: number; latencyMs: number | null; words: number | null }
  >();
  for (const turn of candidateTurns) {
    if (!turn.competencyId) continue;
    const stats = questionStats.get(turn.competencyId) ?? {
      answerSeconds: 0,
      turns: 0,
      latencyMs: null,
      words: null,
    };
    stats.answerSeconds += turnSeconds(turn);
    stats.turns += 1;
    stats.words = (stats.words ?? 0) + turnWords(turn);
    if (turn.responseLatencyMs !== null && stats.latencyMs === null) {
      stats.latencyMs = turn.responseLatencyMs;
    }
    questionStats.set(turn.competencyId, stats);
  }

  // --- red flags -----------------------------------------------------------
  const flags: string[] = [];
  const integrity = scorecard.integrity;
  if (integrity.tabHiddenCount >= 3 || integrity.tabHiddenSeconds >= 60) {
    flags.push(
      `Left the interview window ${integrity.tabHiddenCount} time(s) for ${integrity.tabHiddenSeconds}s in total.`,
    );
  }
  if (integrity.windowBlurCount >= 3) {
    flags.push(`Window lost focus ${integrity.windowBlurCount} times during answers.`);
  }
  if (integrity.candidateDisconnects >= 2) {
    flags.push(`Disconnected ${integrity.candidateDisconnects} times.`);
  }
  if (scorecard.authenticity?.score !== null && scorecard.authenticity !== undefined) {
    const authenticity = scorecard.authenticity.score as number;
    if (authenticity < 50) {
      flags.push(
        `Answer-pattern check scored ${authenticity} of 100 — signs of prepared or fed answers may be present.`,
      );
    }
  }
  if (scorecard.resumeMatch && scorecard.resumeMatch.claims.length > 0) {
    const unsupported = scorecard.resumeMatch.claims.filter(
      (claim) => claim.verdict === "not_supported",
    );
    if (unsupported.length > 0) {
      flags.push(
        `${unsupported.length} resume claim(s) were not supported by the interview (e.g. "${unsupported[0].claim}").`,
      );
    }
  }
  const pattern = scorecard.video?.pattern ?? null;
  if (pattern && pattern.sameSpotAnswers >= 3) {
    flags.push(
      `Looked at the same off-screen spot while answering ${pattern.sameSpotAnswers} answers.`,
    );
  }
  if (scorecard.needsHumanReview) {
    flags.push("Graders disagreed on one or more answers — review the evidence below.");
  }
  const level: "low" | "medium" | "high" =
    flags.length === 0 ? "low" : flags.length >= 3 ? "high" : "medium";
  const redFlags = { level, items: flags };

  // --- next steps ----------------------------------------------------------
  const steps: string[] = [];
  const skipped = scorecard.competencies.filter((item) => item.status === "not_assessed");
  for (const topic of skipped) {
    steps.push(`Cover "${topic.name}" — it was planned but never reached in this interview.`);
  }
  const weakest = scorecard.competencies
    .filter((item) => item.status === "scored" && item.score !== null)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 2);
  for (const item of weakest) {
    if ((item.score as number) < 3.5) {
      steps.push(`Probe "${item.name}" further in the next round — scored ${item.score}/5 here.`);
    }
  }
  if (scorecard.video?.status === "analysed" && (scorecard.video.score ?? 100) < 60) {
    steps.push("Watch the flagged on-camera moments in the video analysis before deciding.");
  }
  if (scorecard.needsHumanReview) {
    steps.push("A human should review the disputed answers — the graders did not agree.");
  }
  if (steps.length === 0 && (band === "strong-hire" || band === "hire")) {
    steps.push("Evidence supports advancing this candidate to the next round.");
  }
  if (steps.length === 0) {
    steps.push("Re-interview or extend the next conversation to gather more evidence.");
  }

  // --- coverage ------------------------------------------------------------
  const scored = scorecard.competencies.filter((item) => item.status === "scored").length;
  const skippedCount = skipped.length;
  const coverage = {
    planned: scorecard.competencies.length,
    scored,
    skipped: skippedCount,
  };

  // --- role benchmark ------------------------------------------------------
  const peerScores = peers
    .filter((peer) => peer.roomId !== session.id)
    .map((peer) => peer.overall?.score ?? null)
    .filter((value): value is number => value !== null);
  const average =
    peerScores.length > 0
      ? Math.round((peerScores.reduce((sum, value) => sum + value, 0) / peerScores.length) * 10) / 10
      : null;
  const benchmark = {
    peers: peerScores.length,
    average,
    label:
      average === null
        ? null
        : score === null
          ? null
          : score >= average
            ? `${Math.round(score - average)} points above the ${peerScores.length}-interview average for this role`
            : `${Math.round(average - score)} points below the ${peerScores.length}-interview average for this role`,
  };

  return { hireBand, talk, speaking, questionStats, redFlags, nextSteps: steps, coverage, benchmark };
}