/**
 * The interview plan: what a structured interview for one role covers. It is
 * generated from the job description and the candidate's resume when the
 * recruiter creates the interview, drives the live interviewer (the agent
 * worker reads it through /api/agent/interviews/:id) and is the rubric the
 * scorecard is graded against afterwards.
 */

/** Behavioural anchors for the 1-5 rating scale of one competency. */
export interface RatingAnchors {
  /** What a 1-2 answer looks like. */
  poor: string;
  /** What a 3 answer looks like. */
  good: string;
  /** What a 5 answer looks like. */
  excellent: string;
}

export interface PlanCompetency {
  /** Stable slug, unique within the plan. */
  id: string;
  name: string;
  /** What is being assessed and why it matters for this role. */
  description: string;
  /** The core question every candidate for this plan is asked. */
  question: string;
  /** Suggested probes; the interviewer adapts them to the actual answer. */
  followUps: string[];
  /** Signals of a strong answer, used to steer probing. */
  lookFor: string[];
  /** A hook into this candidate's resume for the topic, when one exists. */
  resumeProbe: string | null;
  anchors: RatingAnchors;
  /** Relative share of the interview time. */
  minutes: number;
}

export interface InterviewPlan {
  version: 1;
  generatedAt: string;
  /** "fallback" plans are generic: the LLM was unavailable at creation. */
  source: "llm" | "fallback";
  model: string | null;
  /** Short brief of the role for the interviewer. */
  roleSummary: string;
  /** Short brief of the candidate's background for the interviewer. */
  candidateSummary: string;
  /** Ordered by priority: the last ones are dropped first when time is short. */
  competencies: PlanCompetency[];
}

/** How many competencies an interview of a given length can cover properly. */
export function competencyCountFor(durationMinutes: number): number {
  if (durationMinutes <= 5) return 1;
  if (durationMinutes <= 12) return 2;
  if (durationMinutes <= 18) return 3;
  if (durationMinutes <= 25) return 4;
  if (durationMinutes <= 35) return 5;
  return 6;
}
