import "server-only";
import { getInterviewRepository } from "@/server/repositories";
import type { InterviewPlan } from "@/lib/interviews/plan.types";
import type { Scorecard } from "@/lib/interviews/scorecard.types";
import type { InterviewRoom, InterviewTurn } from "@/lib/interviews/interview.types";
import type { AssistantMetricSnapshot } from "@/lib/interviews/assistant.types";

/**
 * A compact, deterministic index of one candidate's report. It is built from
 * stored data only, cached briefly per room, and never persisted: the report
 * already owns the evidence.
 */
export interface CandidateEvidence {
  session: InterviewRoom;
  turns: InterviewTurn[];
  scorecard: Scorecard | null;
  resumeText: string;
  plan: InterviewPlan | null;
  candidateName: string;
  roleTitle: string;
  cacheKey: string;
}

interface CacheEntry {
  key: string;
  evidence: CandidateEvidence;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHED = 16;

export async function loadCandidateEvidence(roomId: string): Promise<CandidateEvidence | null> {
  const repository = getInterviewRepository();
  const session = await repository.get(roomId);
  if (!session) return null;

  const [turns, scorecard] = await Promise.all([
    repository.getTurns(roomId),
    repository.getScorecard(roomId),
  ]);
  const key = [
    scorecard?.generatedAt ?? "no-scorecard",
    turns.length,
    session.completedAt ?? "",
    session.status,
    session.resume?.text.length ?? 0,
  ].join("|");
  const cached = cache.get(roomId);
  if (cached?.key === key) return cached.evidence;

  const evidence: CandidateEvidence = {
    session,
    turns,
    scorecard,
    resumeText:
      session.resume && !session.resume.unreadable ? session.resume.text.trim() : "",
    plan: session.plan,
    candidateName: session.candidateName?.trim() || "Candidate",
    roleTitle: session.roleTitle?.trim() || session.title,
    cacheKey: key,
  };
  cache.set(roomId, { key, evidence });
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return evidence;
}

export function candidateMetrics(evidence: CandidateEvidence): AssistantMetricSnapshot {
  const scorecard = evidence.scorecard;
  const factor = (id: string): number | null => {
    const found = scorecard?.overall?.factors.find((item) => item.id === id);
    return found?.score ?? null;
  };
  const custom: Record<string, number | null> = {};
  for (const parameter of scorecard?.customParameters ?? []) {
    custom[parameter.skill] = parameter.score;
  }
  return {
    overall: scorecard?.overall?.score ?? null,
    answers: factor("answers") ?? scorecard?.answerQuality ?? null,
    resume: factor("resume") ?? scorecard?.resumeMatch?.score ?? null,
    authenticity: factor("authenticity") ?? scorecard?.authenticity?.score ?? null,
    video: factor("video") ?? scorecard?.video?.score ?? null,
    custom,
    decision: evidence.session.decision?.outcome ?? null,
    suggestion: scorecard?.suggestion ?? null,
  };
}

export function renderCandidateRecord(
  evidence: CandidateEvidence,
  options: { includePlan?: boolean; scorecardChars?: number } = {},
): string {
  return [
    `<candidate id="${evidence.session.id}">`,
    `Name: ${evidence.candidateName}`,
    `Role: ${evidence.roleTitle}`,
    `Interview status: ${evidence.session.status}`,
    `Difficulty: ${evidence.session.difficulty}`,
    `Length: ${evidence.session.durationMinutes} minutes`,
    evidence.session.outcome
      ? `Interview ended: ${evidence.session.outcome.reason}, after ${evidence.session.outcome.elapsedSeconds} seconds`
      : "",
    `Resume file: ${evidence.session.resume?.fileName ?? "not provided"}`,
    options.includePlan !== false && evidence.plan
      ? `Prepared questions:\n${renderPlan(evidence.plan)}`
      : "Prepared questions: not repeated for this comparison.",
    evidence.scorecard
      ? `Report and scoring evidence:\n${renderScorecard(evidence.scorecard, options.scorecardChars)}`
      : "Report: no scorecard was generated for this interview.",
    `</candidate>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderPlan(plan: InterviewPlan): string {
  const lines = plan.competencies.map((competency, index) => {
    const lookFor = competency.lookFor.slice(0, 4).join("; ");
    return [
      `Q${index + 1} [${competency.id}] ${competency.name}`,
      `Question: ${competency.question}`,
      lookFor ? `Strong answer signals: ${lookFor}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return lines.join("\n\n").slice(0, 6_000);
}

export function renderScorecard(scorecard: Scorecard, maxChars = 14_000): string {
  const compact = {
    summary: scorecard.summary,
    strengths: scorecard.strengths,
    concerns: scorecard.concerns,
    overall: scorecard.overall ?? null,
    overallScore: scorecard.overallScore,
    suggestion: scorecard.suggestion,
    needsHumanReview: scorecard.needsHumanReview,
    notes: scorecard.notes,
    answerQuality: scorecard.answerQuality ?? null,
    competencies: scorecard.competencies.map((competency) => ({
      name: competency.name,
      status: competency.status,
      score: competency.score,
      rationale: competency.rationale,
      evidence: competency.evidence,
      gaps: competency.gaps,
    })),
    resumeMatch: scorecard.resumeMatch ?? null,
    customParameters: (scorecard.customParameters ?? []).map((parameter) => ({
      skill: parameter.skill,
      status: parameter.status,
      score: parameter.score,
      rationale: parameter.rationale,
      evidence: parameter.evidence,
      resumeEvidence: parameter.resumeEvidence,
      gaps: parameter.gaps,
    })),
    authenticity: scorecard.authenticity
      ? {
          score: scorecard.authenticity.score,
          signals: scorecard.authenticity.signals.map((signal) => ({
            title: signal.title,
            detail: signal.detail,
            severity: signal.severity,
            source: signal.source,
          })),
        }
      : null,
    integrity: {
      tabHiddenCount: scorecard.integrity.tabHiddenCount,
      tabHiddenSeconds: scorecard.integrity.tabHiddenSeconds,
      windowBlurCount: scorecard.integrity.windowBlurCount,
      candidateDisconnects: scorecard.integrity.candidateDisconnects,
      medianResponseLatencyMs: scorecard.integrity.medianResponseLatencyMs,
      notes: scorecard.integrity.notes,
    },
  };
  return JSON.stringify(compact).slice(0, maxChars);
}

export function renderResume(evidence: CandidateEvidence, maxChars = 8_000): string {
  if (!evidence.resumeText) return "No readable resume was provided.";
  return `<resume>\n${evidence.resumeText.slice(0, maxChars)}\n</resume>`;
}

/** Full transcript, or the turns relevant to a targeted question. */
export function renderTranscript(
  evidence: CandidateEvidence,
  options: { broad: boolean; terms: readonly string[]; maxChars?: number },
): { text: string; matched: number; total: number } {
  const candidateTurns = evidence.turns.filter((turn) => turn.speaker === "candidate");
  if (evidence.turns.length === 0) {
    return { text: "The interview has no transcript yet.", matched: 0, total: 0 };
  }

  let selected = evidence.turns;
  let matched = candidateTurns.length;
  if (!options.broad && options.terms.length > 0) {
    const seqs = new Set<number>();
    const competencyIds = matchedCompetencyIds(evidence, options.terms);
    for (const turn of evidence.turns) {
      const text = normalize(turn.text);
      const hit =
        options.terms.some((term) => text.includes(term)) ||
        (turn.competencyId !== null && competencyIds.has(turn.competencyId));
      if (!hit) continue;
      seqs.add(turn.seq);
      // Keep the question before the answer and the immediate follow-up.
      seqs.add(turn.seq - 1);
      seqs.add(turn.seq + 1);
    }
    selected = evidence.turns.filter((turn) => seqs.has(turn.seq));
    matched = selected.filter((turn) => turn.speaker === "candidate").length;
  }

  if (selected.length === 0) {
    return {
      text: `No transcript turns matched ${options.terms.join(", ")} in this relevance-filtered search. This does not prove the interview never covered it; check the report, resume and scorecard before saying the topic is absent.`,
      matched: 0,
      total: candidateTurns.length,
    };
  }

  const lines = selected.map((turn) => {
    const speaker = turn.speaker === "candidate" ? "CANDIDATE" : "INTERVIEWER";
    const topic = turn.competencyId ? ` (topic: ${turn.competencyId})` : "";
    const text = turn.text.length > 1_500 ? `${turn.text.slice(0, 1_500)}…` : turn.text;
    return `[${turn.seq}] ${speaker}${topic}: ${text}`;
  });
  const note =
    !options.broad && options.terms.length > 0
      ? `Relevance-filtered selection: ${matched} of ${candidateTurns.length} candidate turns are shown. This is not the whole interview; do not treat an unselected turn as evidence that the topic was absent.`
      : `All ${candidateTurns.length} candidate turns are included.`;
  const cap = options.maxChars ?? 26_000;
  const full = `${note}\n${lines.join("\n")}`;
  const text =
    full.length > cap ? `${full.slice(0, cap)}\n[transcript truncated for length]` : full;
  return { text, matched, total: candidateTurns.length };
}

export function renderHistory(
  messages: readonly { role: "user" | "assistant"; content: string }[],
): string {
  if (messages.length === 0) return "No previous messages.";
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "RECRUITER" : "ASSISTANT"}: ${message.content.slice(0, 1_600)}`)
    .join("\n\n")
    .slice(0, 10_000);
}

/** Terms that identify what the recruiter is asking about. */
export function questionTerms(question: string): string[] {
  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "this", "that",
    "these", "those", "candidate", "candidates", "person", "they", "them", "their", "he",
    "she", "his", "her", "it", "its", "we", "you", "i", "and", "or", "but", "for", "to",
    "of", "in", "on", "at", "with", "about", "from", "by", "as", "has", "have", "had",
    "does", "did", "do", "can", "could", "would", "should", "will", "what", "which", "who",
    "how", "when", "where", "why", "good", "strong", "weak", "practical", "experience",
    "worked", "work", "using", "use", "used", "know", "knows", "knowledge", "skill",
    "skills", "interview", "answer", "answers", "question", "questions", "tell", "show",
    "mention", "mentioned", "resume", "report", "please", "any", "much", "many", "more",
    "most", "better", "best", "worse", "worst", "compare", "comparison", "versus", "vs",
    "against", "other", "than", "role", "job", "position", "level", "senior", "junior",
    "actually", "really", "truly", "well", "successfully", "correctly", "explain",
    "explained", "describe", "described", "production", "production-level",
  ]);
  const words = normalize(question)
    .split(" ")
    .filter((word) => word.length >= 2 && !stop.has(word));
  const terms = new Set(words);
  const aliases: Record<string, string[]> = {
    k8s: ["kubernetes"],
    kubernetes: ["k8s", "container orchestration"],
    aws: ["amazon web services", "amazon", "ec2", "s3", "lambda"],
    amazon: ["aws", "amazon web services"],
    gcp: ["google cloud", "google cloud platform"],
    react: ["reactjs", "react.js"],
    node: ["nodejs", "node.js"],
    docker: ["containers", "containerization"],
    containers: ["docker", "containerization"],
    ts: ["typescript"],
    js: ["javascript"],
    sql: ["postgres", "postgresql", "mysql", "database"],
    ml: ["machine learning"],
    ai: ["artificial intelligence", "machine learning", "genai", "llm"],
  };
  for (const word of [...terms]) {
    for (const alias of aliases[word] ?? []) terms.add(alias);
  }
  return [...terms].slice(0, 20);
}

export function isBroadQuestion(question: string): boolean {
  return /\b(summary|summarise|summarize|overall|overview|weakness|weaknesses|strength|strengths|technical|communication|communicate|fit|fit for|recommend|hire|hireable|senior|junior|leadership|team|projects?|career|background|growth|improve|improvement|concern|concerns|technical questions?|all questions?|every question)\b/i.test(
    question,
  );
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchedCompetencyIds(evidence: CandidateEvidence, terms: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const competency of evidence.plan?.competencies ?? []) {
    const haystack = normalize(
      `${competency.name} ${competency.description} ${competency.question} ${competency.lookFor.join(" ")}`,
    );
    if (terms.some((term) => haystack.includes(term))) ids.add(competency.id);
  }
  return ids;
}
