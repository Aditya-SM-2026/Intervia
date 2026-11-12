import { z } from "zod";
import {
  BASE_APPLICATION_FIELD_IDS,
  BASE_APPLICATION_FIELDS,
  MANDATORY_BASE_FIELD_IDS,
  isBaseFieldId,
  type ApplicationField,
} from "./application.types.ts";

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
export const FIELD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

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

// ---------------------------------------------------------------------------
// The complete form: built-in fields and extra questions in one ordered list.
// ---------------------------------------------------------------------------

const MAX_FORM_FIELDS = MAX_FIELDS + BASE_APPLICATION_FIELDS.length;

const formFieldSchema = z.object({
  id: z.string().trim().regex(FIELD_ID_PATTERN, "A field id must be a short slug."),
  label: z
    .string()
    .trim()
    .min(1, "Every field needs a label.")
    .max(MAX_LABEL_LENGTH, `A field label must be at most ${MAX_LABEL_LENGTH} characters.`),
  type: z.enum(["text", "textarea", "number", "select", "yesno", "file"]),
  required: z.boolean().default(false),
  options: z
    .array(z.string().trim().min(1).max(MAX_LABEL_LENGTH))
    .max(MAX_OPTIONS, `A dropdown can offer at most ${MAX_OPTIONS} choices.`)
    .optional(),
  hint: z.string().trim().max(200).optional(),
  system: z.boolean().optional(),
});

/** One item of a complete form: a built-in field or a recruiter question. */
export const applicationFormFieldSchema = formFieldSchema.superRefine((field, ctx) => {
  if (field.system) {
    if (!isBaseFieldId(field.id)) {
      ctx.addIssue({ code: "custom", message: `"${field.id}" is not a built-in field.` });
      return;
    }
    const base = BASE_APPLICATION_FIELDS.find((candidate) => candidate.id === field.id);
    if (base && field.type !== base.type) {
      ctx.addIssue({
        code: "custom",
        message: `The ${base.label} field cannot change its input type.`,
        path: ["type"],
      });
    }
    if ((MANDATORY_BASE_FIELD_IDS as readonly string[]).includes(field.id) && !field.required) {
      ctx.addIssue({
        code: "custom",
        message: `${base?.label ?? field.label} is required for every application.`,
        path: ["required"],
      });
    }
    return;
  }
  if (isBaseFieldId(field.id)) {
    ctx.addIssue({
      code: "custom",
      message: `"${field.id}" is reserved for a built-in field.`,
      path: ["id"],
    });
    return;
  }
  if (field.type === "file") {
    ctx.addIssue({
      code: "custom",
      message: "Only the resume field can accept a file.",
      path: ["type"],
    });
  }
  if (field.type === "select" && (!field.options || field.options.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: `The dropdown "${field.label}" needs at least one choice.`,
      path: ["options"],
    });
  }
});

/** A whole form, including the built-in fields it must keep. */
export const applicationFormFieldsSchema = z
  .array(applicationFormFieldSchema)
  .max(MAX_FORM_FIELDS, `A form can have at most ${MAX_FORM_FIELDS} questions.`)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field.id)) {
        ctx.addIssue({ code: "custom", message: "Two questions share the same id." });
        return;
      }
      seen.add(field.id);
    }
    if (!fields.some((field) => field.system)) {
      ctx.addIssue({
        code: "custom",
        message: "The form must keep its built-in fields.",
      });
      return;
    }
    for (const id of MANDATORY_BASE_FIELD_IDS) {
      if (!seen.has(id)) {
        const label = BASE_APPLICATION_FIELDS.find((field) => field.id === id)?.label ?? id;
        ctx.addIssue({
          code: "custom",
          message: `${label} cannot be removed from the form.`,
        });
      }
    }
  });

/** True when a form is the built-in fields plus questions (the current shape). */
export function hasSystemApplicationFields(fields: readonly ApplicationField[]): boolean {
  return fields.some((field) => field.system === true);
}

/** Built-in field ids, exposed for validation helpers in tests. */
export const RESERVED_FIELD_IDS = BASE_APPLICATION_FIELD_IDS;

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
  /** Qualification chosen from the built-in dropdown. */
  education: z.string().trim().max(120, "This qualification is too long.").optional(),
  /**
   * CGPA or percentage as typed, kept as a number so it can be filtered. Both
   * scales are accepted (8.4 out of 10, 78 as a percentage) because colleges
   * differ; the raw value is shown beside the qualification.
   */
  cgpa: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? undefined : String(value).trim()))
    .refine((value) => value === undefined || value === "" || /^\d+(\.\d+)?$/.test(value), {
      message: "Enter the CGPA as a number, for example 8.4 or 78.",
    })
    .refine(
      (value) => value === undefined || value === "" || Number(value) <= 100,
      { message: "Enter a CGPA or percentage between 0 and 100." },
    ),
});

export type ApplicationIdentity = z.infer<typeof applicationIdentitySchema>;

/** Answers to the recruiter's own fields: required ones must be present, and
 * dropdown answers must be one of the offered choices.
 */
export function validateAnswers(
  fields: readonly ApplicationField[],
  answers: Record<string, string>,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (field.system) continue;
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

/** Extra questions only, in form order. */
export function customApplicationFields(
  fields: readonly ApplicationField[],
): ApplicationField[] {
  return fields.filter((field) => !field.system);
}

/**
 * Required built-in fields that a submitted application left empty. Name,
 * email and phone are also validated by applicationIdentitySchema; this check
 * covers the recruiter-made decision about the college roll number and keeps
 * the label the applicant saw.
 */
export function validateRequiredProfileFields(
  fields: readonly ApplicationField[],
  values: { name?: string; phone?: string; email?: string; collegeId?: string },
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (!field.system || !field.required || field.id === "resume") continue;
    const value = values[field.id as keyof typeof values];
    if (!value || value.trim() === "") {
      errors.push(`${field.label} is required.`);
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
