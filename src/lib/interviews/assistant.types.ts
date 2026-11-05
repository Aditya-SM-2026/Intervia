/**
 * Recruiter-facing candidate assistant.
 *
 * Conversations are anchored to one interview report. A question can also
 * deliberately pull in other candidates (comparison) or a role-wide ranking,
 * but every evidence item is labelled with the room it came from. One
 * candidate's words are never presented as another's.
 */

export type AssistantScope = "candidate" | "comparison" | "portfolio";

export type AssistantConfidence = "high" | "medium" | "low";

export interface AssistantResumeEvidence {
  quote: string;
  note: string;
}

export interface AssistantTurnEvidence {
  turnSeq: number;
  quote: string;
  note: string;
}

export interface AssistantCandidateAnswer {
  kind: "candidate";
  assessment: string;
  resumeEvidence: {
    found: boolean;
    items: AssistantResumeEvidence[];
  };
  interviewEvidence: {
    discussed: boolean;
    items: AssistantTurnEvidence[];
  };
  confidence: AssistantConfidence;
  confidenceReason: string;
  missingEvidence: string | null;
  followUps: string[];
}

export interface AssistantMetricSnapshot {
  /** The 0-100 weighted total. */
  overall: number | null;
  answers: number | null;
  resume: number | null;
  authenticity: number | null;
  video: number | null;
  /** Recruiter custom parameters keyed by skill name, 0-100. */
  custom: Record<string, number | null>;
  decision: string | null;
  suggestion: string | null;
}

export interface AssistantComparisonCandidate {
  roomId: string;
  name: string;
  role: string;
  metrics: AssistantMetricSnapshot;
  assessment: string;
  resumeEvidence: AssistantResumeEvidence[];
  interviewEvidence: AssistantTurnEvidence[];
  confidence: AssistantConfidence;
}

export interface AssistantComparisonDimension {
  label: string;
  leaderRoomId: string | null;
  note: string;
}

export interface AssistantComparisonAnswer {
  kind: "comparison";
  assessment: string;
  candidates: AssistantComparisonCandidate[];
  dimensions: AssistantComparisonDimension[];
  verdict: string;
  confidence: AssistantConfidence;
  confidenceReason: string;
  caveats: string[];
}

export interface AssistantRankingRow {
  roomId: string;
  name: string;
  role: string;
  overall: number | null;
  metricValue: number | null;
  decision: string | null;
  suggestion: string | null;
}

export interface AssistantPortfolioAnswer {
  kind: "portfolio";
  answer: string;
  role: string | null;
  metricLabel: string;
  rows: AssistantRankingRow[];
  confidence: AssistantConfidence;
  confidenceReason: string;
  caveats: string[];
}

/** A clarification or "no matching candidate" reply, saved like any other. */
export interface AssistantNoticeAnswer {
  kind: "notice";
  message: string;
  options: string[];
}

export type AssistantAnswer =
  | AssistantCandidateAnswer
  | AssistantComparisonAnswer
  | AssistantPortfolioAnswer
  | AssistantNoticeAnswer;

export interface AssistantConversation {
  id: string;
  roomId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  /** Plain text kept for history and search; the structured card is in `answer`. */
  content: string;
  answer: AssistantAnswer | null;
  scope: AssistantScope;
  referencedRoomIds: string[];
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

/** Compact candidate row used for name resolution and role rankings. */
export interface AssistantCandidateRef {
  roomId: string;
  candidateName: string | null;
  roleTitle: string | null;
  roleId: string | null;
  status: string;
  overall: number | null;
  answers: number | null;
  resume: number | null;
  authenticity: number | null;
  video: number | null;
  customScores: Record<string, number | null>;
  decision: string | null;
  suggestion: string | null;
}

export interface AssistantAskResponse {
  conversationId: string;
  message: AssistantMessage;
  scope: AssistantScope;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
