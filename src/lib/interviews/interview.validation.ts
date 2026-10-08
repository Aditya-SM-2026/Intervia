import { z } from "zod";

const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 240;
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
      .optional(),
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

/** Flattens a ZodError into one readable message for API error responses. */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}