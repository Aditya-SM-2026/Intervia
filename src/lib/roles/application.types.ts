/**
 * Public application form: one revocable link per role, and the applications
 * it collects. The five identity fields are fixed; anything else in a form is
 * a recruiter-defined extra field stored with the link.
 */

/** Input types a recruiter can add on top of the fixed identity fields. */
export type ApplicationFieldType = "text" | "textarea" | "number" | "select" | "yesno";

/** One recruiter-defined question on a role's form. */
export interface ApplicationField {
  /** Stable slug used as the answer key; never shown to the applicant. */
  id: string;
  label: string;
  type: ApplicationFieldType;
  required: boolean;
  /** Choices for a "select" field. */
  options?: string[];
  /** Optional helper text under the label. */
  hint?: string;
}

/** Fixed fields every form asks for; they cannot be removed. */
export const BASE_APPLICATION_FIELDS = [
  { id: "name", label: "Full name" },
  { id: "phone", label: "Phone number" },
  { id: "email", label: "Email address" },
  { id: "collegeId", label: "College roll number" },
  { id: "resume", label: "Resume" },
] as const;

/** Where an application stands. "scheduled" means an interview was booked. */
export type ApplicationStatus = "new" | "scheduled" | "rejected";

/** One submitted application. */
export interface RoleApplication {
  id: string;
  roleId: string;
  name: string;
  phone: string;
  email: string;
  collegeId: string | null;
  /** Answers to the recruiter-defined fields, keyed by field id. */
  answers: Record<string, string>;
  resumeFileName: string | null;
  /** Durable object path in the recordings bucket, when the upload succeeded. */
  resumeObjectPath: string | null;
  /** True when resume text could be extracted and stored. */
  hasResumeText: boolean;
  status: ApplicationStatus;
  /** Interview created from this application, when one was booked. */
  interviewId: string | null;
  createdAt: string;
}

/** The role's shareable form link and the questions it asks. */
export interface RoleFormLink {
  roleId: string;
  token: string;
  fields: ApplicationField[];
  createdAt: string;
  revokedAt: string | null;
}

/** What a visitor sees after opening /apply/<token>. */
export interface PublicApplicationForm {
  roleTitle: string;
  roleDescription: string;
  fields: ApplicationField[];
}

/** Shape of GET/POST /api/roles/[roleId]/form-link. */
export interface RoleFormLinkResponse {
  token: string;
  url: string;
  fields: ApplicationField[];
}

/** Shape of GET /api/roles/[roleId]/applications. */
export interface RoleApplicationsResponse {
  applications: RoleApplication[];
  total: number;
}

/** A readable, unique field id derived from the label the recruiter typed. */
export function suggestFieldId(label: string, taken: Iterable<string> = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "field";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
