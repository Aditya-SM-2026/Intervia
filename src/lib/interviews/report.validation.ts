import { z } from "zod";
import type { IntegrityLevel, InterviewReport, TranscriptTurn } from "./report.types";

/**
 * Zod schemas for the report domain: validation of the LLM's structured
 * output before it is ever saved, and defensive validation of data read
 * back from storage.
 */

/** Pipeline turn shape; fields may be null on partial/legacy data. */
export const transcriptTurnSchema = z.object({
  seq: z.number().int(),
  speaker: z.enum(["interviewer", "candidate"]),
  text: z.string(),
  askedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
});

export const transcriptTurnsSchema = z.array(transcriptTurnSchema);

export const integritySignalSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  evidenceTurnSeq: z.array(z.number().int()),
  weight: z.number().min(0).max(100),
});

export const reportAnalysisSchema = z.object({
  topics: z.array(
    z.object({
      topic: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  jdCoverage: z.array(
    z.object({
      skill: z.string().min(1),
      probed: z.boolean(),
      evidenceTurnSeq: z.array(z.number().int()),
    }),
  ),
});

export const reportIntegritySchema = z.object({
  probability: z.number().min(0).max(100),
  level: z.enum(["low", "medium", "high"]),
  signals: z.array(integritySignalSchema),
});

/** Full stored report, validated defensively on every read from storage. */
export const interviewReportSchema = z.object({
  roomId: z.string().min(1),
  generatedAt: z.string().min(1),
  analysis: reportAnalysisSchema,
  integrity: reportIntegritySchema,
  engineMeta: z.object({
    model: z.string().min(1),
    generatedAt: z.string().min(1),
  }),
  notes: z.array(z.string()),
});

/**
 * What the LLM is asked to return (probability only — the level is derived in
 * code so the model can never produce a self-contradicting report). Values
 * are accepted unbounded here and clamped in the service; booleans/numbers
 * tolerate string forms ("true", "70%") so one quirky value does not discard
 * an otherwise valid analysis.
 */
const llmBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === "yes" || value === 1,
  z.boolean(),
);
const llmNumber = z.preprocess(
  (value) => (typeof value === "string" ? Number.parseFloat(value.replace(/[%,\s]/g, "")) : value),
  z.coerce.number(),
);
const llmSeqArray = z.array(z.coerce.number().int());

export const llmReportOutputSchema = z.object({
  analysis: z.object({
    topics: z.array(
      z.object({
        topic: z.string().min(1),
        summary: z.string().min(1),
      }),
    ),
    strengths: z.array(z.string().min(1)),
    weaknesses: z.array(z.string().min(1)),
    jdCoverage: z.array(
      z.object({
        skill: z.string().min(1),
        probed: llmBoolean,
        evidenceTurnSeq: llmSeqArray,
      }),
    ),
  }),
  integrity: z.object({
    probability: llmNumber,
    signals: z.array(
      integritySignalSchema.extend({
        weight: llmNumber,
        evidenceTurnSeq: llmSeqArray,
      }),
    ),
  }),
});

export type LlmReportOutput = z.infer<typeof llmReportOutputSchema>;

/** Maps a 0-100 probability onto its integrity level. */
export function deriveIntegrityLevel(probability: number): IntegrityLevel {
  if (probability >= 70) return "high";
  if (probability >= 40) return "medium";
  return "low";
}

/** Validates turn data read from storage, returning null when invalid. */
export function parseStoredTurns(value: unknown): TranscriptTurn[] | null {
  const parsed = transcriptTurnsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Validates a stored report, returning null when it does not match the schema. */
export function parseStoredReport(value: unknown): InterviewReport | null {
  const parsed = interviewReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}