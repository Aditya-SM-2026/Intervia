import "server-only";
import { createLlmProvider } from "@/lib/ai/llm-provider";
import { LlmError } from "@/lib/ai/llm-error";
import type { AiMessage } from "@/lib/ai/ai.types";
import { getLlmConfig } from "@/lib/config/env";
import type { InterviewRoom } from "./interview.types";
import { getInterviewRoom } from "./interview.service";
import { getInterviewRepository } from "@/server/repositories";
import {
  deriveIntegrityLevel,
  llmReportOutputSchema,
} from "./report.validation";
import type {
  InterviewReport,
  InterviewReportResponse,
  JdCoverageEntry,
  IntegritySignal,
  ReportIntegrity,
  TranscriptTurn,
} from "./report.types";

/**
 * Post-interview report generation.
 *
 * Trigger (MVP choice, documented): reports are generated lazily on the FIRST
 * recruiter view of the report endpoint and then cached in the `reports`
 * table — never during the interview, never again on later views. A
 * regenerate endpoint re-runs generation and overwrites the cache; a
 * background pass after `status = completed` can be added later by calling
 * the same service after the interview ends. This keeps the interview
 * pipeline free of LLM analysis work and avoids burning LLM calls for
 * interviews nobody inspects. A crashed or partial session is analyzed from
 * whatever turns the pipeline persisted. Concurrent first views are
 * deduplicated in-process, so one interview generates at most one LLM call
 * per web process.
 *
 * Inputs (read-only, written by the pre-interview pipeline): session record
 * (JD, resume, consent) + transcript turns with per-answer latency.
 */

/** Below this many candidate answers a report would be hallucinated, not analyzed. */
const MIN_CANDIDATE_TURNS = 5;

/**
 * Report analysis is one long reasoning task over the whole conversation, far
 * bigger than a live interview reply, so it gets its own generous timeout
 * instead of the chat default (OMINIBOT_TIMEOUT_MS).
 */
const REPORT_LLM_TIMEOUT_MS = 180_000;

export const ANALYSIS_SYSTEM_PROMPT = [
  "You are an interview analysis engine for a hiring platform.",
  "You receive: a job description (JD), optionally a resume, and the transcript of a completed",
  "spoken interview as JSON — an array of turns with",
  '{"seq": number, "speaker": "interviewer" | "candidate", "text": string, "latencyMs": number | null}.',
  'For candidate turns latencyMs is the time from the question being sent to the final answer ("answeredAt − askedAt").',
  "",
  "Respond with ONLY one JSON object — no markdown fences, no commentary — exactly:",
  "{",
  '  "analysis": {',
  '    "topics": [{"topic": string, "summary": string}],',
  '    "strengths": [string],',
  '    "weaknesses": [string],',
  '    "jdCoverage": [{"skill": string, "probed": boolean, "evidenceTurnSeq": [number]}]',
  "  },",
  '  "integrity": {',
  '    "probability": number,',
  '    "signals": [{"type": string, "description": string, "evidenceTurnSeq": [number], "weight": number}]',
  "  }",
  "}",
  "",
  "Field rules:",
  "- topics: every theme that came up, in order; summarize what the candidate actually answered (2-3 sentences each).",
  "- strengths/weaknesses: concrete and tied to the transcript, not generic advice.",
  "- jdCoverage: every required skill from the JD; probed=true when the interviewer asked about it, false when skipped.",
  "  Cite the turn seq(s) of the questions or answers that show it. If no JD is provided return an empty array.",
  "- integrity.probability: 0-100 estimate that the candidate's answers were AI-generated or heavily AI-assisted.",
  "- integrity.signals: transcript-grounded evidence of AI assistance. Known types (open list):",
  '  "instant-polished-answer" (answer to a hard question arrives suspiciously fast AND is fully polished; use latencyMs),',
  '  "templated-phrasing" (answers share identical structure or wording across different questions),',
  '  "contradiction-on-repeat" (contradicts a reworded revisit of the same topic),',
  '  "refusal-to-elaborate" (deflects or repeats when asked to go deeper on a detail),',
  '  "resume-answer-mismatch" (claims that conflict with the resume, or resume-perfect recall of personal history),',
  '  "copy-like-prose" (written-register prose unlike natural spoken language),',
  '  "generic-answers" (content-free answers that dodge specifics).',
  "  Use other descriptive types when warranted.",
  "- evidenceTurnSeq: the seq numbers of the turns your claim rests on, copied EXACTLY from the transcript input.",
  "  NEVER invent a seq that is not in the transcript, and never describe content from a turn you do not cite.",
  "- weight: 0-100, roughly how much the signal contributes to the probability; probability should be consistent with the signal weights.",
  "- If there is no evidence of AI assistance, return an empty signals array and a low probability.",
  "- Judge only what the transcript, JD and resume show; never speculate about anything not visible in them.",
].join("\n");

/**
 * Loading (or generating) the report for one room. Never throws for expected
 * states: missing data comes back as `report: null` with a reason. With
 * `force` the cached report is ignored and regenerated (regenerate button).
 */
export async function getInterviewReport(
  roomId: string,
  options?: { force?: boolean },
): Promise<
  | { ok: true; result: InterviewReportResponse }
  | { ok: false; code: "ROOM_NOT_FOUND" }
> {
  const room = await getInterviewRoom(roomId);
  if (!room) {
    return { ok: false, code: "ROOM_NOT_FOUND" };
  }

  const repository = getInterviewRepository();
  const turns = await repository.getTurns(roomId);

  if (!options?.force) {
    const cached = await repository.getReport(roomId);
    if (cached) {
      return { ok: true, result: { session: room, turns, report: cached, reason: null } };
    }
  }

  const rejection = reportRejectionReason(room, turns);
  if (rejection) {
    return { ok: true, result: { session: room, turns, report: null, reason: rejection } };
  }

  try {
    const report = await generateReportOnce(room, turns);
    await repository.saveReport(report);
    return { ok: true, result: { session: room, turns, report, reason: null } };
  } catch (error) {
    const message = describeGenerationError(error);
    console.error(`[report] generation failed for interview ${roomId}: ${message}`);
    return {
      ok: true,
      result: {
        session: room,
        turns,
        report: null,
        reason: `Report generation failed: ${message}. Viewing the page again will retry.`,
      },
    };
  }
}

/** In-flight generation keyed by roomId, so concurrent views share one LLM call. */
const inFlightReports = new Map<string, Promise<InterviewReport>>();

async function generateReportOnce(room: InterviewRoom, turns: TranscriptTurn[]): Promise<InterviewReport> {
  const existing = inFlightReports.get(room.id);
  if (existing) return existing;

  const generation = generateReport(room, turns).finally(() => {
    inFlightReports.delete(room.id);
  });
  inFlightReports.set(room.id, generation);
  return generation;
}

/**
 * Decides whether a report can exist at all. Every rejection is a clear,
 * recruiter-facing reason — never a crash, never a hallucinated report.
 */
function reportRejectionReason(room: InterviewRoom, turns: TranscriptTurn[]): string | null {
  if (turns.length === 0) {
    return room.status === "scheduled" || room.status === "active"
      ? "The interview has not produced any conversation yet. The candidate may not have joined or verified their email."
      : "The candidate never joined or never verified their email, so no conversation was recorded.";
  }
  const candidateTurns = turns.filter((turn) => turn.speaker === "candidate");
  if (candidateTurns.length < MIN_CANDIDATE_TURNS) {
    return `Insufficient interview content: only ${candidateTurns.length} candidate answer(s) were recorded. A meaningful report needs at least ${MIN_CANDIDATE_TURNS}.`;
  }
  return null;
}

/** Data-quality notes that must surface to the recruiter in the report. */
function buildNotes(room: InterviewRoom): string[] {
  const notes: string[] = [];
  if (!room.consent) {
    notes.push("No consent was recorded for this session.");
  }
  if (!room.jobDescription?.text) {
    notes.push("No job description was provided; JD coverage is not assessed.");
  }
  if (!room.resume || room.resume.unreadable) {
    notes.push(
      room.resume?.unreadable
        ? "The resume could not be parsed; the interview ran JD-only and this assessment does not use resume content."
        : "No resume was attached to this session; resume-vs-answer checks were skipped.",
    );
  }
  return notes;
}

async function generateReport(room: InterviewRoom, turns: TranscriptTurn[]): Promise<InterviewReport> {
  const provider = createLlmProvider({ timeoutMs: REPORT_LLM_TIMEOUT_MS });
  const reply = await provider.generateReply(buildAnalysisMessages(room, turns));

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonObject(reply.text);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : "The analysis did not return JSON.");
  }

  const parsed = llmReportOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error(
      `[report] analysis output failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")
        .slice(0, 500)}`,
    );
    throw new LlmError("The analysis did not match the expected format.");
  }

  const notes = buildNotes(room);
  const hasJd = Boolean(room.jobDescription?.text);

  const integrity = buildIntegrity(parsed.data.integrity.probability, parsed.data.integrity.signals, turns);
  const droppedSignals = parsed.data.integrity.signals.length - integrity.signals.length;
  if (droppedSignals > 0) {
    console.warn(
      `[report] dropped ${droppedSignals} signal(s) for interview ${room.id}: evidence seqs not grounded in the transcript`,
    );
  }

  const jdCoverage = hasJd
    ? groundJdCoverage(parsed.data.analysis.jdCoverage, turns)
    : [];
  const droppedCoverage = hasJd ? parsed.data.analysis.jdCoverage.length - jdCoverage.length : 0;
  if (droppedCoverage > 0) {
    console.warn(
      `[report] dropped ${droppedCoverage} JD coverage entr(ies) for interview ${room.id}: ungrounded seqs`,
    );
  }

  return {
    roomId: room.id,
    generatedAt: new Date().toISOString(),
    analysis: {
      topics: parsed.data.analysis.topics,
      strengths: parsed.data.analysis.strengths,
      weaknesses: parsed.data.analysis.weaknesses,
      jdCoverage,
    },
    integrity,
    engineMeta: {
      model: getLlmConfig().model,
      generatedAt: new Date().toISOString(),
    },
    notes,
  };
}

function buildAnalysisMessages(room: InterviewRoom, turns: TranscriptTurn[]): AiMessage[] {
  const jd = room.jobDescription?.text?.trim();
  const resume = room.resume?.unreadable
    ? "(resume could not be parsed — do not use resume content)"
    : room.resume?.text?.trim();

  const sections: string[] = [
    jd ? `Job description:\n${jd}` : "Job description: (none provided — return an empty jdCoverage array)",
    resume ? `Resume:\n${resume}` : "Resume: (none provided — skip resume-vs-answer checks)",
    "Interview transcript:",
    JSON.stringify(
      turns.map((turn) => ({
        seq: turn.seq,
        speaker: turn.speaker,
        text: turn.text,
        latencyMs: turn.latencyMs,
      })),
    ),
  ];
  return [
    { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content: sections.join("\n\n") },
  ];
}

/** Pulls the first balanced JSON object out of a reply that may be fenced or padded. */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced ? fenced[1] : text;

  const start = source.indexOf("{");
  if (start === -1) throw new LlmError("The analysis did not contain a JSON object.");

  // Brace-match the first balanced object (string-aware), so trailing
  // commentary or a second JSON blob after it cannot break the parse.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        const slice = source.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          throw new LlmError("The analysis response was not valid JSON.");
        }
      }
    }
  }
  throw new LlmError("The analysis contained an unterminated JSON object.");
}

/**
 * Clamps the model's numbers, derives the level, and enforces traceability:
 * every cited seq must exist in the transcript. Signals whose evidence seqs
 * are all invalid are dropped, so the report can never cite a turn that does
 * not exist.
 */
function buildIntegrity(
  probability: number,
  signals: Array<{ type: string; description: string; evidenceTurnSeq: number[]; weight: number }>,
  turns: TranscriptTurn[],
): ReportIntegrity {
  const validSeqs = new Set(turns.map((turn) => turn.seq));

  const groundedSignals: IntegritySignal[] = signals
    .map((signal) => ({
      type: signal.type.trim() || "unclassified",
      description: signal.description.trim(),
      evidenceTurnSeq: [...new Set(signal.evidenceTurnSeq)].filter((seq) => validSeqs.has(seq)),
      weight: clampPercent(signal.weight),
    }))
    .filter((signal) => signal.description.length > 0 && signal.evidenceTurnSeq.length > 0);

  const clampedProbability = clampPercent(probability);
  return {
    probability: clampedProbability,
    level: deriveIntegrityLevel(clampedProbability),
    signals: groundedSignals,
  };
}

/** Same traceability rule for JD coverage entries. */
function groundJdCoverage(
  coverage: Array<{ skill: string; probed: boolean; evidenceTurnSeq: number[] }>,
  turns: TranscriptTurn[],
): JdCoverageEntry[] {
  const validSeqs = new Set(turns.map((turn) => turn.seq));
  return coverage
    .map((entry) => ({
      skill: entry.skill.trim(),
      probed: entry.probed === true,
      evidenceTurnSeq: [...new Set(entry.evidenceTurnSeq)].filter((seq) => validSeqs.has(seq)),
    }))
    .filter((entry) => entry.skill.length > 0);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function describeGenerationError(error: unknown): string {
  if (error instanceof LlmError) return error.message; // deliberately safe messages
  if (error instanceof SyntaxError) return "The analysis response was not valid JSON.";
  return "the analysis service could not be reached.";
}