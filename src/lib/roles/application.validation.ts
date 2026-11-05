import { z } from "zod";
import type { ApplicationField } from "@/lib/roles/application.types";

/**
 * Validation for the public application form. Pure, so the rules stay
 * unit-testable; storage and HTTP live in the service and the routes.
 */

const MAX_FIELDS = 20;
const MAX_LABEL_LENGTH = 80;
const MAX_OPTIONS = 20;
const MAX_ANSWER_LENGTH = 2_000;
const MAX_COLLEGE_ID_LENGTH = 60;

/** Field ids are generated slugs; answers are stored against them. */
export const FIELD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const applicationFieldSchema = z
  .object({
    id: z.string().trim().regex(FIELD_ID_PATTERN, "A field id must be a short slug."),
    label: z
      .string()
      .trim()
      .min(1, "Every field needs a label.")
      .max(MAX_LABEL_LENGTH, `A field label must be at most ${MAX_LABEL_LENGTH} characters.`),
    type: z.enum(["text", "textarea", "number", "select", "yesno"]),
    required: z.boolean().default(false),
    options: z
      .array(z.string().trim().min(1).max(MAX_LABEL_LENGTH))
      .max(MAX_OPTIONS, `A dropdown can offer at most ${MAX_OPTIONS} choices.`)
      .optional(),
    hint: z.string().trim().max(200).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select" && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: `The dropdown "${field.label}" needs at least one choice.`,
        path: ["options"],
      });
    }
  });

export const applicationFieldsSchema = z
  .array(applicationFieldSchema)
  .max(MAX_FIELDS, `A form can have at most ${MAX_FIELDS} extra fields.`)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field.id)) {
        ctx.addIssue({ code: "custom", message: "Two fields share the same id." });
        return;
      }
      seen.add(field.id);
    }
  });

/** Phone numbers as people type them: digits, spaces, +, - and brackets. */
const PHONE_PATTERN = /^\+?[\d\s()-]{7,20}$/;

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/** Turns the multipart "answers" field (a JSON string) into an object. */
export function parseAnswersInput(raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined || raw === "") return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry.trim().slice(0, MAX_ANSWER_LENGTH);
  }
  return out;
}

/** Identity fields shown on every form, validated the same way server-side. */
export const applicationIdentitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your full name.")
    .max(200, "Your name is too long."),
  phone: z
    .string()
    .trim()
    .regex(PHONE_PATTERN, "Enter a valid phone number.")
    .refine((value) => digitCount(value) >= 7 && digitCount(value) <= 15, {
      message: "Enter a valid phone number.",
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(200, "This email address is too long."),
  collegeId: z
    .string()
    .trim()
    .max(MAX_COLLEGE_ID_LENGTH, "This roll number is too long.")
    .optional(),
});

export type ApplicationIdentity = z.infer<typeof applicationIdentitySchema>;

/**
 * Answers to the recruiter's own fields: required ones must be present, and
 * dropdown answers must be one of the offered choices.
 */
export function validateAnswers(
  fields: readonly ApplicationField[],
  answers: Record<string, string>,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const value = (answers[field.id] ?? "").trim();
    if (field.required && value === "") {
      errors.push(`${field.label} is required.`);
      continue;
    }
    if (value !== "" && field.type === "select" && field.options?.length) {
      if (!field.options.includes(value)) {
        errors.push(`${field.label} must be one of the offered choices.`);
      }
    }
    if (value !== "" && field.type === "number" && !Number.isFinite(Number(value))) {
      errors.push(`${field.label} must be a number.`);
    }
    if (value.length > MAX_ANSWER_LENGTH) {
      errors.push(`${field.label} is too long.`);
    }
  }
  return errors;
}

/** Extra fields that arrive as JSON in the multipart body. */
export function parseFieldsInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
