import "server-only";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/structured";
import type { AssistantScope } from "@/lib/interviews/assistant.types";
import { renderHistory } from "./context";

const routeSchema = z.object({
  route: z.enum(["candidate", "compare", "rank"]).catch("candidate"),
  candidates: z.array(z.string().trim().min(1).max(100)).max(5).catch([]),
  role: z.string().trim().max(100).nullish().catch(null),
  metric: z
    .enum(["overall", "answers", "resume", "authenticity", "video", "custom", "none"])
    .catch("overall"),
  metricName: z.string().trim().max(80).nullish().catch(null),
});

export interface AssistantRoute {
  scope: AssistantScope;
  candidateNames: string[];
  roleQuery: string | null;
  metric: "overall" | "answers" | "resume" | "authenticity" | "video" | "custom" | "none";
  metricName: string | null;
}

const CROSS_PATTERN =
  /\b(compare|compared|comparison|versus|vs\.?|better than|worse than|stronger than|weaker than|against|who scored|who has scored|who has the (strongest|best|most)|who is the (strongest|best|most)|who knows|who understands|who is better|who's better|which candidate|top candidate|top candidates|best candidate|strongest candidate|highest|lowest|rank|ranking|all candidates|across candidates|other candidate|other candidates)\b/i;

const FOLLOW_UP =
  /^(what about|how about|and |what about their|what about his|what about her|the other|both|between them|which one|who is better)/i;

const CANDIDATE_CONTEXT =
  /\b(candidate|candidates|they|them|their|theirs|he|him|his|she|her|hers|this person|the person|this interview|the interview|interview|report|resume|cv|transcript|answer|answers|answered|score|scores|scored|rating|rated|role|job|position|fit|hire|hirable|experience|skill|skills|project|projects|strength|strengths|weakness|weaknesses|assessment|evaluate|evaluation)\b/i;

const GENERAL_INTENT =
  /^(what|who|when|where|why|how|define|explain|describe|tell me about|can you explain|could you explain)\b/i;

const GENERAL_FOLLOW_UP =
  /^(why|how so|tell me more|explain|what does that mean|and what|what about that)\b/i;

/**
 * Obvious outside-knowledge questions skip the candidate evidence pack.
 * Anything that mentions the candidate, report or an evaluation stays on the
 * report path, where the model can still mark an unrelated answer as general.
 */
export function isLikelyGeneralQuestion(question: string, lastScope: AssistantScope | null): boolean {
  const text = question.trim();
  if (!text || CANDIDATE_CONTEXT.test(text)) return false;
  if (lastScope === "general" && text.length < 140 && GENERAL_FOLLOW_UP.test(text)) return true;
  return GENERAL_INTENT.test(text);
}

/**
 * Most questions are candidate-only and must not pay for a routing call.
 * Only comparison and role-wide language reaches the router.
 */
export function needsCrossCandidateRoute(
  question: string,
  lastScope: AssistantScope | null,
): boolean {
  if (CROSS_PATTERN.test(question)) return true;
  if (lastScope === "comparison" || lastScope === "portfolio") {
    return question.length < 220 && FOLLOW_UP.test(question.trim());
  }
  return false;
}

export async function routeQuestion(input: {
  question: string;
  anchorName: string;
  anchorRole: string;
  history: readonly { role: "user" | "assistant"; content: string }[];
}): Promise<AssistantRoute> {
  const prompt = [
    "You route a recruiter's question for an interview evidence assistant.",
    "Return one JSON object only.",
    "",
    `The report currently open is for ${input.anchorName} (${input.anchorRole}).`,
    "",
    "Routes:",
    '- "candidate": the question is only about the open candidate.',
    '- "compare": the recruiter wants the open candidate compared with one or more named candidates, or is continuing a comparison. Put the other candidate names in candidates. Do not include the open candidate in candidates.',
    '- "rank": the recruiter wants a role-wide or multi-candidate ranking, for example "who scored more in the AI role" or "top AWS candidates". Set role when a role is named. Put the metric in metric and metricName.',
    "",
    "metric: overall, answers, resume, authenticity, video, custom, or none.",
    "metricName: the skill or custom parameter when metric is custom, otherwise null.",
    "",
    "Recent conversation:",
    renderHistory(input.history),
    "",
    `Current question: ${input.question}`,
  ];

  // `generateStructured` only takes a single user block; the history is part
  // of that block so the router can resolve "them", "the other one" and
  // follow-up questions.
  const result = await generateStructured({
    system: [
      "You route questions for an HR candidate assistant. Be literal and conservative.",
      "Only choose compare or rank when the question actually asks for another candidate or a ranking.",
      "Never invent candidate names. Copy names exactly as the recruiter wrote them.",
      "Reply with JSON: { route, candidates, role, metric, metricName }.",
    ].join("\n"),
    user: prompt.join("\n"),
    schema: routeSchema,
    timeoutMs: 12_000,
    temperature: 0,
  });

  const scope: AssistantScope =
    result.data.route === "compare"
      ? "comparison"
      : result.data.route === "rank"
        ? "portfolio"
        : "candidate";

  const rawRole = result.data.role?.trim() || null;
  const roleQuery =
    rawRole && /^(the )?(this|same|current) role$/i.test(rawRole)
      ? input.anchorRole
      : rawRole;

  return {
    scope,
    candidateNames: result.data.candidates,
    roleQuery,
    metric: result.data.metric,
    metricName: result.data.metricName?.trim() || null,
  };
}
