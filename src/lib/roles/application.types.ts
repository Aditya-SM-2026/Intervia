/**
 * Public application form: one revocable link per role, and the applications
 * it collects. The five identity fields are built in; everything else is a
 * recruiter-defined extra field stored with the link. Both kinds live in the
 * same ordered list so the editor can reorder them freely, with `system` true
 * marking the built-in fields.
 */

import type { ScreeningSnapshot } from "@/lib/screening/types";

/** Input types on an application form. "file" belongs to the resume only. */
export type ApplicationFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "yesno"
  | "file";

/** One question on a role's form. */
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
  /**
   * True for the built-in fields (name, phone, email, college roll number,
   * resume). They are stored in the same list so order is preserved, but
   * answers to them live in their own application columns.
   */
  system?: boolean;
}

/** Ids of the built-in fields. */
export type BaseApplicationFieldId =
  | "name"
  | "phone"
  | "email"
  | "collegeId"
  | "education"
  | "cgpa"
  | "resume";

/**
 * Built-in fields that must always be on the form: an application cannot be
 * created or followed up without them, so the editor never offers to remove
 * them or make them optional.
 */
export const MANDATORY_BASE_FIELD_IDS = ["name", "phone", "email", "resume"] as const;

/** Built-in fields a recruiter may remove or mark optional. */
export const OPTIONAL_BASE_FIELD_IDS = ["collegeId"] as const;

/**
 * Built-in fields added to every form, including forms saved before they
 * existed. They are never required, so an applicant who has no CGPA is not
 * blocked; they can still edit the label and order.
 */
export const ALWAYS_ON_BASE_FIELD_IDS = ["education", "cgpa"] as const;

/** Every built-in field id. */
export const BASE_APPLICATION_FIELD_IDS: readonly BaseApplicationFieldId[] = [
  "name",
  "phone",
  "email",
  "collegeId",
  "education",
  "cgpa",
  "resume",
];

/**
 * Qualifications offered on the built-in education field. A dropdown keeps the
 * value filterable: free text would give "B.Tech", "btech" and "B.E" as three
 * different answers to the same question.
 */
export const EDUCATION_OPTIONS: readonly string[] = [
  "B.Tech",
  "B.E",
  "B.Sc",
  "BCA",
  "B.Com",
  "B.A",
  "M.Tech",
  "M.E",
  "M.Sc",
  "MCA",
  "MBA",
  "M.Com",
  "PhD",
  "Diploma",
  "Other",
];

/** The built-in fields every role's form starts with, in display order. */
export const BASE_APPLICATION_FIELDS: readonly ApplicationField[] = [
  { id: "name", label: "Full name", type: "text", required: true, system: true },
  { id: "phone", label: "Phone number", type: "text", required: true, system: true },
  { id: "email", label: "Email address", type: "text", required: true, system: true },
  { id: "collegeId", label: "College roll number", type: "text", required: false, system: true },
  {
    id: "education",
    label: "Education qualification",
    type: "select",
    required: false,
    options: [...EDUCATION_OPTIONS],
    system: true,
  },
  {
    id: "cgpa",
    label: "CGPA or percentage",
    type: "number",
    required: false,
    hint: "For example 8.4 (out of 10) or 78 (percentage).",
    system: true,
  },
  { id: "resume", label: "Resume", type: "file", required: true, system: true },
];

export function isBaseFieldId(id: string): id is BaseApplicationFieldId {
  return (BASE_APPLICATION_FIELD_IDS as readonly string[]).includes(id);
}

/** True when the built-in field can never be removed or made optional. */
export function isMandatoryBaseField(id: string): boolean {
  return (MANDATORY_BASE_FIELD_IDS as readonly string[]).includes(id);
}

/** A fresh copy of the default form fields. */
export function defaultApplicationFormFields(): ApplicationField[] {
  return BASE_APPLICATION_FIELDS.map((field) => ({ ...field }));
}

/**
 * The published form for a role. Rows saved before the editor showed built-in
 * fields contain only extra questions; those are returned after the default
 * built-in fields. Mandatory built-ins are re-added if a stored form is
 * missing one, so a candidate can always identify themselves.
 */
export function resolveApplicationFormFields(
  stored: readonly ApplicationField[] | null | undefined,
): ApplicationField[] {
  const list = Array.isArray(stored) ? [...stored] : [];
  const hasSystem = list.some((field) => field.system === true);
  if (!hasSystem) {
    return [...BASE_APPLICATION_FIELDS.map((field) => ({ ...field })), ...list];
  }
  const present = new Set(list.map((field) => field.id));
  for (const field of BASE_APPLICATION_FIELDS) {
    const alwaysOn = (ALWAYS_ON_BASE_FIELD_IDS as readonly string[]).includes(field.id);
    const mandatory = (MANDATORY_BASE_FIELD_IDS as readonly string[]).includes(field.id);
    if ((mandatory || alwaysOn) && !present.has(field.id)) {
      list.push({ ...field });
    }
  }
  return list;
}

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
  /** Qualification picked on the built-in education field. */
  education: string | null;
  /** CGPA or percentage as typed by the candidate, or null. */
  cgpa: number | null;
  /** Recruiter's manual shortlist decision; null when nobody has decided. */
  shortlisted: boolean | null;
  /** Answers to the recruiter-defined fields, keyed by field id. */
  answers: Record<string, string>;
  resumeFileName: string | null;
  /** Durable object path in the recordings bucket, when the upload succeeded. */
  resumeObjectPath: string | null;
  /** True when resume text could be extracted and stored. */
  hasResumeText: boolean;
  /** When the candidate last replaced the resume; null when never replaced. */
  resumeUpdatedAt: string | null;
  status: ApplicationStatus;
  /** Interview created from this application, when one was booked. */
  interviewId: string | null;
  /** Resume screening result, when one has run. Null means never screened. */
  screening?: ScreeningSnapshot | null;
  createdAt: string;
}

/** The role's shareable form link and the questions it asks. */
export interface RoleFormLink {
  roleId: string;
  token: string;
  fields: ApplicationField[];
  createdAt: string;
  revokedAt: string | null;
  /** Close the link once this many applications have arrived. Null = no cap. */
  maxApplications: number | null;
  /** Close the link this many hours after it (re)started. Null = no deadline. */
  expiresAfterHours: number | null;
  /** When this link started collecting; a new link resets it. */
  roundStartedAt: string;
}

/** Why a form link is not accepting applications. */
export type FormLinkClosedReason = "revoked" | "expired" | "limit";

/** Live state of one link: whether it is open, why not, and how many arrived. */
export interface FormLinkStatus {
  open: boolean;
  closedReason: FormLinkClosedReason | null;
  applicationsReceived: number;
  maxApplications: number | null;
  expiresAfterHours: number | null;
  /** Computed from roundStartedAt + expiresAfterHours, or null without a deadline. */
  expiresAt: string | null;
  roundStartedAt: string;
}

/** What a visitor sees after opening /apply/<token>. */
export interface PublicApplicationForm {
  roleTitle: string;
  roleDescription: string;
  fields: ApplicationField[];
}

/** Result of resolving a public token, including why a closed one is closed. */
export interface PublicApplicationState {
  form: PublicApplicationForm | null;
  closedReason: FormLinkClosedReason | null;
}

/** What the candidate sees on their private resume-replacement page. */
export interface PublicResumeUpdateState {
  roleTitle: string;
  candidateName: string;
  fileName: string | null;
  /** When the resume was last replaced, or null when it never was. */
  updatedAt: string | null;
  /** When the link stops working. */
  expiresAt: string;
  open: boolean;
  /** Why replacement is unavailable; null while it is open. */
  closedMessage: string | null;
}

/** Shape of GET/POST /api/roles/[roleId]/form-link. */
export interface RoleFormLinkResponse {
  token: string;
  url: string;
  fields: ApplicationField[];
  status: FormLinkStatus;
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
