import "server-only";
import { ZodError } from "zod";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import {
  applicationFieldsSchema,
  applicationIdentitySchema,
  parseAnswersInput,
  validateAnswers,
  type ApplicationIdentity,
} from "@/lib/roles/application.validation";
import { storeResumeFile } from "@/lib/uploads/resume-storage";
import {
  validateResumeUpload,
  type ResumeUploadFileKind,
} from "@/lib/uploads/resume-upload";
import {
  getRolesRepository,
  newApplicationId,
} from "@/server/repositories/roles-repository";
import type {
  ApplicationField,
  ApplicationStatus,
  PublicApplicationForm,
  RoleApplication,
  RoleFormLinkResponse,
} from "@/lib/roles/application.types";

/**
 * The shareable application form on top of the roles repository. All input
 * arrives untrusted from HTTP; identity fields, extra answers and the resume
 * are validated here and in application.validation.ts.
 */

const MAX_APPLICATIONS_PAGE = 100;

function repository() {
  return getRolesRepository();
}

function originUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/apply/${token}`;
}

/** The role's link, its questions and the absolute URL to share. */
export async function getRoleFormLink(
  roleId: string,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const link = await repository().getOrCreateFormLink(roleId);
  return { token: link.token, url: originUrl(origin, link.token), fields: link.fields };
}

/** The role's current questions, without creating a link. */
export async function readRoleFormFields(
  roleId: string,
): Promise<ApplicationField[] | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const link = await repository().getFormLink(roleId);
  return link?.fields ?? [];
}

/** Replaces the role's extra questions. The identity fields are always asked. */
export async function saveApplicationFields(
  roleId: string,
  rawFields: unknown,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const fields = applicationFieldsSchema.parse(rawFields ?? []) as ApplicationField[];
  const link = await repository().getOrCreateFormLink(roleId);
  const updated = await repository().updateFormLinkFields(roleId, fields);
  const token = updated?.token ?? link.token;
  return { token, url: originUrl(origin, token), fields: updated?.fields ?? fields };
}

/** Stops the current link working. Applications already collected stay. */
export async function revokeRoleFormLink(roleId: string): Promise<boolean> {
  const role = await repository().getRole(roleId);
  if (!role) return false;
  await repository().revokeFormLink(roleId);
  return true;
}

/** What the public page shows, or null when the token is unknown or revoked. */
export async function getPublicApplicationForm(
  token: string,
): Promise<PublicApplicationForm | null> {
  const role = await repository().getRoleByFormToken(token);
  if (!role) return null;
  const link = await repository().getFormLink(role.id);
  return { roleTitle: role.title, roleDescription: role.description, fields: link?.fields ?? [] };
}

export type SubmitApplicationResult =
  | { ok: true; applicationId: string }
  | { ok: false; code: "token" | "invalid" | "duplicate"; message: string };

/**
 * Handles one public submission: validates everything, stores the resume in
 * the recordings bucket, then records the application. A duplicate email for
 * the same role is refused rather than creating a second row.
 */
export async function submitApplication(
  token: string,
  form: FormData,
): Promise<SubmitApplicationResult> {
  const role = await repository().getRoleByFormToken(token);
  if (!role) {
    return { ok: false, code: "token", message: "This application link is no longer open." };
  }

  let identity: ApplicationIdentity;
  try {
    identity = applicationIdentitySchema.parse({
      name: asText(form.get("name")),
      phone: asText(form.get("phone")),
      email: asText(form.get("email")),
      collegeId: asText(form.get("collegeId")),
    });
  } catch (error) {
    return { ok: false, code: "invalid", message: firstIssue(error, "Check your details and try again.") };
  }

  const link = await repository().getFormLink(role.id);
  const fields = link?.fields ?? [];
  const answers = parseAnswersInput(form.get("answers"));
  const answerErrors = validateAnswers(fields, answers);
  if (answerErrors.length > 0) {
    return { ok: false, code: "invalid", message: answerErrors[0] };
  }

  const file = form.get("resume");
  if (!(file instanceof File)) {
    return { ok: false, code: "invalid", message: "Attach your resume (PDF, DOC or DOCX)." };
  }
  const validation = validateResumeUpload({ name: file.name, size: file.size });
  if (!validation.ok) {
    const messages = {
      empty: "The resume file is empty.",
      too_large: "The resume must be smaller than 10 MB.",
      unsupported_type: "Attach your resume as a PDF, DOC or DOCX file.",
    } as const;
    return { ok: false, code: "invalid", message: messages[validation.reason] };
  }

  const applicationId = newApplicationId();
  const data = Buffer.from(await file.arrayBuffer());
  const stored = await storeResumeFile(
    applicationId,
    validation.kind as ResumeUploadFileKind,
    data,
    file.name,
  );

  let text = "";
  if (validation.kind === "pdf") {
    try {
      text = await extractPdfText(file, "Resume");
    } catch (error) {
      if (!(error instanceof PdfExtractionError)) throw error;
    }
  }

  const created = await repository().createApplication({
    id: applicationId,
    roleId: role.id,
    name: identity.name,
    phone: identity.phone,
    email: identity.email,
    collegeId: identity.collegeId?.trim() ? identity.collegeId.trim() : null,
    answers,
    resumeFileName: file.name,
    resumeText: text,
    resumeObjectPath: stored.objectPath,
  });

  if (!created) {
    return {
      ok: false,
      code: "duplicate",
      message: `You have already applied for ${role.title} with this email address.`,
    };
  }
  return { ok: true, applicationId: created.id };
}

/** Every application for a role, newest first. Null when the role is unknown. */
export async function listRoleApplications(
  roleId: string,
  limit = 50,
  offset = 0,
): Promise<{ applications: RoleApplication[]; total: number } | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const size = Math.min(Math.max(limit, 1), MAX_APPLICATIONS_PAGE);
  return repository().listApplications(roleId, size, Math.max(offset, 0));
}

export async function getRoleApplication(
  roleId: string,
  applicationId: string,
): Promise<RoleApplication | null> {
  return repository().getApplication(roleId, applicationId);
}

/** Applies a recruiter action to one application. */
export async function decideApplication(
  roleId: string,
  applicationId: string,
  action: "reject" | "restore" | "scheduled",
  interviewId?: string | null,
): Promise<RoleApplication | null> {
  const status: ApplicationStatus =
    action === "reject" ? "rejected" : action === "scheduled" ? "scheduled" : "new";
  return repository().updateApplicationStatus(
    roleId,
    applicationId,
    status,
    action === "scheduled" ? interviewId ?? null : null,
  );
}

export async function getApplicationResumeFile(
  roleId: string,
  applicationId: string,
): Promise<{ fileName: string | null; objectPath: string | null; text: string } | null> {
  return repository().getApplicationResume(roleId, applicationId);
}

function asText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function firstIssue(error: unknown, fallback: string): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? fallback;
  }
  return fallback;
}
