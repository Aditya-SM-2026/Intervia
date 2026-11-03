import type { Role } from "@/lib/roles/role.types";

/**
 * What the new-interview form starts with when it was opened from a role's
 * "Add candidate" action. Plain, serialisable data so it can travel from the
 * server page into the client form.
 */
export interface InterviewRoleDefaults {
  id: string;
  title: string;
  /** Role description plus its skills, as one editable job-description draft. */
  jobDescription: string;
}

/**
 * Builds the prefill for an interview created for a specific role. A role's
 * description is its job description, so it goes in as-is; the skills list is
 * appended so the generated plan knows what to probe.
 */
export function roleToInterviewDefaults(role: Role): InterviewRoleDefaults {
  const description = role.description.trim();
  const skills = role.skills.map((skill) => skill.trim()).filter(Boolean);
  const parts: string[] = [];
  if (description) parts.push(description);
  if (skills.length > 0) parts.push(`Required skills: ${skills.join(", ")}`);
  return {
    id: role.id,
    title: role.title,
    jobDescription: parts.join("\n\n"),
  };
}
