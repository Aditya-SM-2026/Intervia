import { z } from "zod";

const MIN_TITLE_LENGTH = 1;
const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 240;

/** Room IDs are generated server-side and must match this pattern when received. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN, "Invalid room ID format");

/** Turns empty strings into undefined so optional fields behave as optional. */
function emptyToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const createInterviewSchema = z.object({
  title: z
    .string()
    .trim()
    .min(MIN_TITLE_LENGTH, "Interview title is required")
    .max(MAX_TITLE_LENGTH, `Interview title must be at most ${MAX_TITLE_LENGTH} characters`),
  candidateName: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(MAX_NAME_LENGTH, `Candidate name must be at most ${MAX_NAME_LENGTH} characters`)
      .optional(),
  ),
  durationMinutes: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int("Duration must be a whole number of minutes")
      .min(MIN_DURATION_MINUTES, `Duration must be at least ${MIN_DURATION_MINUTES} minutes`)
      .max(MAX_DURATION_MINUTES, `Duration must be at most ${MAX_DURATION_MINUTES} minutes`)
      .optional(),
  ),
});

export type CreateInterviewPayload = z.infer<typeof createInterviewSchema>;

/** Flattens a ZodError into one readable message for API error responses. */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}