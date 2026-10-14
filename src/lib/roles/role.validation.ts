import { z } from "zod";
// Relative import so node --test can run this module without path aliases.
import { formatValidationIssues } from "../interviews/interview.validation.ts";

/** Shared rules for role fields, used by both create and update. */
const titleSchema = z
  .string()
  .trim()
  .min(2, "Role title must be at least 2 characters.")
  .max(120, "Role title must be at most 120 characters.");

const descriptionSchema = z
  .string()
  .trim()
  .min(10, "Job description must be at least 10 characters.")
  .max(20_000, "Job description must be at most 20,000 characters.");

const skillsSchema = z
  .array(z.string().trim().min(1, "Skills cannot contain blank entries.").max(80))
  .max(30, "At most 30 skills.")
  .default([]);

/** A plain date (YYYY-MM-DD) or null. Rejects malformed or impossible dates. */
const deadlineSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Deadline must be a date in YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Deadline must be a real calendar date.")
  .nullable()
  .default(null);

export const createRoleSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  skills: skillsSchema,
  deadline: deadlineSchema,
});

/**
 * Update rules reuse the shared field rules but without defaults: an absent
 * field must stay absent, or a status-only update would wipe skills.
 */
export const updateRoleSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    skills: z
      .array(z.string().trim().min(1, "Skills cannot contain blank entries.").max(80))
      .max(30, "At most 30 skills.")
      .optional(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Deadline must be a date in YYYY-MM-DD format.")
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, "Deadline must be a real calendar date.")
      .nullable()
      .optional(),
    status: z.enum(["open", "completed"]).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Provide at least one field to update.",
  );

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Formats a validation failure the way the existing APIs do. */
export function formatRoleValidationIssues(error: z.ZodError): string {
  return formatValidationIssues(error);
}