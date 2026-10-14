import { z } from "zod";

const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
/**
 * Real interviews run 10-45 minutes. The minimum is 2 so the whole flow
 * (plan, interview, wrap-up, scorecard) can be tried quickly.
 */
export const MIN_DURATION_MINUTES = 2;
export const MAX_DURATION_MINUTES = 45;
export const DEFAULT_DURATION_MINUTES = 20;
const MAX_JD_TEXT_LENGTH = 20_000;

/** Room IDs are generated server-side and must match this pattern when received. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN, "Invalid room ID format");

/** Turns empty strings into undefined so optional fields behave as optional. */
function emptyToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const createInterviewSchema = z.object({
  title: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(MAX_TITLE_LENGTH, `Interview title must be at most ${MAX_TITLE_LENGTH} characters`)
      .optional(),
  ),
  recruiterName: z
    .string()
    .trim()
    .min(1, "Recruiter name is required")
    .max(MAX_NAME_LENGTH, `Recruiter name must be at most ${MAX_NAME_LENGTH} characters`),
  candidateName: z
    .string()
    .trim()
    .min(1, "Candidate name is required")
    .max(MAX_NAME_LENGTH, `Candidate name must be at most ${MAX_NAME_LENGTH} characters`),
  candidateEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Candidate email must be a valid email address")
    .max(MAX_NAME_LENGTH, `Candidate email must be at most ${MAX_NAME_LENGTH} characters`),
  scheduledDate: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Interview date must use the YYYY-MM-DD format")
      .optional(),
  ),
  scheduledTime: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Interview time must use the HH:MM 24-hour format")
      .optional(),
  ),
  roleTitle: z
    .string()
    .trim()
    .min(1, "Role title is required")
    .max(MAX_TITLE_LENGTH, `Role title must be at most ${MAX_TITLE_LENGTH} characters`),
  durationMinutes: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int("Duration must be a whole number of minutes")
      .min(MIN_DURATION_MINUTES, `Duration must be at least ${MIN_DURATION_MINUTES} minutes`)
      .max(MAX_DURATION_MINUTES, `Duration must be at most ${MAX_DURATION_MINUTES} minutes`)
      .default(DEFAULT_DURATION_MINUTES),
  ),
  difficulty: z.preprocess(
    emptyToUndefined,
    z
      .enum(["easy", "medium", "hard", "extra-hard"], {
        message: "Difficulty must be one of: easy, medium, hard, extra-hard",
      })
      .default("medium"),
  ),
  voiceMode: z.preprocess(
    emptyToUndefined,
    z
      .enum(["standard", "rolling"], { message: "Voice mode must be one of: standard, rolling" })
      .default("standard"),
  ),
  jobDescriptionText: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .min(1, "Job description text cannot be empty")
      .max(MAX_JD_TEXT_LENGTH, `Job description text must be at most ${MAX_JD_TEXT_LENGTH} characters`)
      .optional(),
  ),
});

export type CreateInterviewPayload = z.infer<typeof createInterviewSchema>;

/**
 * Candidate email gate: the email must match the session and consent must be
 * explicitly given before join credentials are issued.
 */
export const verifyEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(MAX_NAME_LENGTH, `Email must be at most ${MAX_NAME_LENGTH} characters`),
  consent: z
    .boolean()
    .refine((value) => value, "Consent is required to join the interview"),
});

export type VerifyEmailPayload = z.infer<typeof verifyEmailSchema>;

/** Recruiter's hiring decision on a finished interview. */
export const decisionSchema = z.object({
  outcome: z.enum(["advance", "hold", "reject"], {
    message: "Decision must be one of: advance, hold, reject",
  }),
  note: z.string().trim().max(2000, "Note must be at most 2000 characters").default(""),
});

const isoTimestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "Invalid timestamp",
});

/** Batch of turns and events posted by the agent worker. */
export const agentEventsSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.enum(["interviewer", "candidate"]),
        text: z.string().min(1).max(20_000),
        startedAt: isoTimestamp.nullable().default(null),
        endedAt: isoTimestamp.nullable().default(null),
        responseLatencyMs: z.number().int().min(0).max(3_600_000).nullable().default(null),
        interrupted: z.boolean().default(false),
        phase: z.string().max(40).nullable().default(null),
        competencyId: z.string().max(80).nullable().default(null),
      }),
    )
    .max(200)
    .default([]),
  events: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        at: isoTimestamp,
        data: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(1000)
    .default([]),
});

/** Completion record posted by the agent worker when the interview ends. */
export const agentCompleteSchema = z.object({
  reason: z.string().min(1).max(60),
  startedAt: isoTimestamp.nullable().default(null),
  endedAt: isoTimestamp,
  elapsedSeconds: z.number().min(0).max(86_400),
  completed: z.boolean().default(true),
  coverage: z
    .array(
      z.object({
        competencyId: z.string().max(80),
        name: z.string().max(200),
        status: z.enum(["covered", "skipped", "pending"]),
        startedAtSeconds: z.number().nullable().default(null),
        endedAtSeconds: z.number().nullable().default(null),
        budgetSeconds: z.number().nullable().default(null),
        interviewerSummary: z.string().max(2000).nullable().default(null),
        interviewerEvidence: z.string().max(40).nullable().default(null),
        advancedBy: z.enum(["interviewer", "controller"]).nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
  usage: z.array(z.unknown()).max(20).default([]),
  modelSessions: z.number().int().min(0).max(10_000).optional(),
});

/** Flattens a ZodError into one readable message for API error responses. */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}