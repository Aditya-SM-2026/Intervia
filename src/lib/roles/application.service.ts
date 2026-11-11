import "server-only";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import {
  applicationFieldsSchema,
  applicationFormFieldsSchema,
  applicationIdentitySchema,
  customApplicationFields,
  parseAnswersInput,
  validateAnswers,
  validateRequiredProfileFields,
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
  PublicApplicationState,
  PublicResumeUpdateState,
  RoleApplication,
  RoleFormLink,
  RoleFormLinkResponse,
} from "@/lib/roles/application.types";
import {
  defaultApplicationFormFields,
  resolveApplicationFormFields,
} from "@/lib/roles/application.types";
import {
  closedReasonMessage,
  formLinkStatus,
} from "@/lib/roles/form-link-status";
import {
  isResumeUpdateOpen,
  isResumeUpdateToken,
  resumeUpdateExpiresAt,
  samePhone,
} from "@/lib/roles/resume-update";
import { screenApplication } from "@/lib/screening/screening.service";

/**
 * The shareable application form on top of the roles repository. All input
 * arrives untrusted from HTTP; identity fields, extra answers and the resume
 * are validated here and in application.validation.ts.
 */

const MAX_APPLICATIONS_PAGE = 100;

/** 24 random bytes, URL-safe: the private resume-replacement credential. */
function newResumeUpdateToken(): string {
  return randomBytes(24).toString("base64url");
}

function repository() {
  return getRolesRepository();
}

function originUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/apply/${token}`;
}

/**
 * The role's link, creating one on first use. A link the recruiter turned off
 * stays off until they bring it back explicitly, so reading never revives it.
 */
async function ensureFormLink(roleId: string): Promise<RoleFormLink> {
  const existing = await repository().getFormLink(roleId);
  return existing ?? repository().getOrCreateFormLink(roleId);
}

/** The role's link, its questions and the absolute URL to share. */
export async function getRoleFormLink(
  roleId: string,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const link = await ensureFormLink(roleId);
  return formLinkResponse(link, origin);
}

/** Brings a link the recruiter turned off back to life, same token. */
export async function reEnableRoleFormLink(
  roleId: string,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const link = await repository().getOrCreateFormLink(roleId);
  return formLinkResponse(link, origin);
}

/** Live status of one link: open or closed, why, and how many arrived. */
async function formLinkResponse(
  link: RoleFormLink,
  origin: string,
): Promise<RoleFormLinkResponse> {
  const received = await repository().countApplicationsSince(link.roleId, link.roundStartedAt);
  return {
    token: link.token,
    url: originUrl(origin, link.token),
    fields: resolveApplicationFormFields(link.fields),
    status: formLinkStatus(link, received),
  };
}

/** The role's current questions, without creating a link. */
export async function readRoleFormFields(
  roleId: string,
): Promise<ApplicationField[] | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const link = await repository().getFormLink(roleId);
  return resolveApplicationFormFields(link?.fields);
}

/**
 * Replaces the role's form. A complete form (built-in fields flagged with
 * `system`) is stored as sent. Requests that send only extra questions, as
 * older clients do, keep the role's existing built-in fields and append the
 * new questions.
 */
export async function saveApplicationFields(
  roleId: string,
  rawFields: unknown,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const list = Array.isArray(rawFields) ? rawFields : [];
  const includesSystemFields = list.some(
    (field) =>
      field !== null &&
      typeof field === "object" &&
      (field as { system?: unknown }).system === true,
  );
  const link = await ensureFormLink(roleId);
  let fields: ApplicationField[];
  if (includesSystemFields) {
    fields = applicationFormFieldsSchema.parse(list) as ApplicationField[];
  } else {
    const extras = applicationFieldsSchema.parse(list) as ApplicationField[];
    const existingBase = resolveApplicationFormFields(link.fields).filter(
      (field) => field.system,
    );
    fields = [
      ...(existingBase.length > 0 ? existingBase : defaultApplicationFormFields()),
      ...extras,
    ];
  }
  const updated = await repository().updateFormLinkFields(roleId, fields);
  return formLinkResponse(updated ?? link, origin);
}

/** Stores the role's own limits: close after N applications or N hours. */
export async function saveFormLinkSettings(
  roleId: string,
  rawSettings: { maxApplications?: unknown; expiresAfterHours?: unknown },
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const maxApplications = parseLimit(rawSettings.maxApplications);
  const expiresAfterHours = parseLimit(rawSettings.expiresAfterHours);
  const link = await ensureFormLink(roleId);
  const updated = await repository().updateFormLinkSettings(roleId, {
    maxApplications,
    expiresAfterHours,
  });
  return formLinkResponse(updated ?? link, origin);
}

/** Issues a brand-new link: new token, fresh counter, previous token dead. */
export async function rotateRoleFormLink(
  roleId: string,
  origin: string,
): Promise<RoleFormLinkResponse | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  await ensureFormLink(roleId);
  const rotated = await repository().rotateFormLink(roleId);
  return rotated ? formLinkResponse(rotated, origin) : null;
}

/**
 * Reads a cap from untrusted input. Empty, zero, negative and non-numeric all
 * mean "no limit", which is what an untouched settings field sends.
 */
function parseLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const whole = Math.floor(parsed);
  if (whole <= 0) return null;
  return Math.min(whole, 1_000_000);
}

/** Stops the current link working. Applications already collected stay. */
export async function revokeRoleFormLink(roleId: string): Promise<boolean> {
  const role = await repository().getRole(roleId);
  if (!role) return false;
  await repository().revokeFormLink(roleId);
  return true;
}

/** What the public page shows, or why the link is closed. */
export async function getPublicApplicationState(
  token: string,
): Promise<PublicApplicationState> {
  const role = await repository().getRoleByFormToken(token);
  if (!role) return { form: null, closedReason: null };
  const link = await repository().getFormLink(role.id);
  // A rotated link replaces the token, so an old URL must not resolve.
  if (!link || link.token !== token) return { form: null, closedReason: null };
  const received = await repository().countApplicationsSince(role.id, link.roundStartedAt);
  const status = formLinkStatus(link, received);
  if (!status.open) return { form: null, closedReason: status.closedReason };
  return {
    form: {
      roleTitle: role.title,
      roleDescription: role.description,
      fields: resolveApplicationFormFields(link.fields),
    },
    closedReason: null,
  };
}

export type SubmitApplicationResult =
  | {
      ok: true;
      applicationId: string;
      /** Null when an existing application was refreshed instead of created. */
      resumeUpdateToken: string | null;
      /** True when this submission replaced the resume on an earlier one. */
      updated: boolean;
      /** The file that was replaced, when this was an update. */
      previousFileName: string | null;
    }
  | { ok: false; code: "token" | "invalid" | "duplicate" | "closed"; message: string };

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
  const activeLink = await repository().getFormLink(role.id);
  if (!activeLink || activeLink.token !== token) {
    return { ok: false, code: "token", message: "This application link is no longer open." };
  }
  const receivedSoFar = await repository().countApplicationsSince(
    role.id,
    activeLink.roundStartedAt,
  );
  const linkStatus = formLinkStatus(activeLink, receivedSoFar);
  if (!linkStatus.open) {
    return {
      ok: false,
      code: "closed",
      message: closedReasonMessage(linkStatus.closedReason),
    };
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

  const fields = resolveApplicationFormFields(activeLink.fields);
  const profileErrors = validateRequiredProfileFields(fields, identity);
  if (profileErrors.length > 0) {
    return { ok: false, code: "invalid", message: profileErrors[0] };
  }
  const answers = parseAnswersInput(form.get("answers"));
  const answerErrors = validateAnswers(customApplicationFields(fields), answers);
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

  // A second submission with the same email is not a duplicate to refuse: the
  // candidate is usually fixing a wrong resume. The phone on the application
  // has to match, so knowing an email alone is not enough to change it.
  const existing = await repository().getApplicationByEmail(role.id, identity.email);
  if (existing && existing.status === "rejected") {
    return {
      ok: false,
      code: "closed",
      message: "This application is closed, so its resume can no longer be changed.",
    };
  }
  if (existing && !samePhone(existing.phone, identity.phone)) {
    return {
      ok: false,
      code: "duplicate",
      message: `You have already applied for ${role.title} with this email address. To replace your resume, use the same phone number you applied with.`,
    };
  }

  const applicationId = existing?.id ?? newApplicationId();
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

  const collegeId = identity.collegeId?.trim() ? identity.collegeId.trim() : null;

  if (existing) {
    const updated = await repository().refreshApplication(existing.id, {
      name: identity.name,
      collegeId,
      answers,
      fileName: file.name,
      text,
      objectPath: stored.objectPath,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      return {
        ok: false,
        code: "duplicate",
        message: `You have already applied for ${role.title} with this email address.`,
      };
    }
    if (role.screeningEnabled !== false) {
      queueScreening(role.id, updated.id);
    }
    return {
      ok: true,
      applicationId: updated.id,
      resumeUpdateToken: null,
      updated: true,
      previousFileName: existing.resumeFileName,
    };  }

  const resumeUpdateToken = newResumeUpdateToken();
  const created = await repository().createApplication({
    id: applicationId,
    roleId: role.id,
    name: identity.name,
    phone: identity.phone,
    email: identity.email,
    collegeId,
    answers,
    resumeFileName: file.name,
    resumeText: text,
    resumeObjectPath: stored.objectPath,
    resumeUpdateToken,
  });

  if (!created) {
    return {
      ok: false,
      code: "duplicate",
      message: `You have already applied for ${role.title} with this email address. If your resume needs replacing, open the private link you were shown after applying.`,
    };
  }
  if (role.screeningEnabled !== false) {
    queueScreening(role.id, created.id);
  }
  return {
    ok: true,
    applicationId: created.id,
    resumeUpdateToken,
    updated: false,
    previousFileName: null,
  };
}

/**
 * Screens a freshly received application in the background. The candidate's
 * confirmation must not wait 2-6 seconds for a model call, and a failure here
 * is not their problem: the application is already stored, and the recruiter
 * can re-run it from the role page.
 */
export function queueScreening(roleId: string, applicationId: string): void {
  void screenApplication(roleId, applicationId).catch((error: unknown) => {
    console.warn(
      `[screening] ${applicationId} could not be screened: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
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

// ---------------------------------------------------------------------------
// Replacing the resume after the application was sent
// ---------------------------------------------------------------------------

const RESUME_UPDATE_EXPIRED = "This resume link has expired. Ask the recruiting team for help.";
const RESUME_UPDATE_REJECTED = "This application is closed, so its resume can no longer be changed.";

/**
 * What the candidate's private replace page shows: the role, the file on
 * record, and whether replacement is still allowed. Null when the token is
 * unknown.
 */
export async function getResumeUpdateState(
  token: string,
): Promise<PublicResumeUpdateState | null> {
  if (!isResumeUpdateToken(token)) return null;
  const application = await repository().getApplicationByResumeToken(token);
  if (!application) return null;
  const role = await repository().getRole(application.roleId);
  const expiresAt = resumeUpdateExpiresAt(application);
  const withinWindow = isResumeUpdateOpen(application);
  const open = withinWindow && application.status !== "rejected";
  return {
    roleTitle: role?.title ?? "this role",
    candidateName: application.name,
    fileName: application.resumeFileName,
    updatedAt: application.resumeUpdatedAt,
    expiresAt,
    open,
    closedMessage: open
      ? null
      : application.status === "rejected"
        ? RESUME_UPDATE_REJECTED
        : RESUME_UPDATE_EXPIRED,
  };
}

export type ReplaceResumeResult =
  | { ok: true; fileName: string; updatedAt: string }
  | { ok: false; code: "token" | "expired" | "closed" | "invalid"; message: string };

/**
 * Swaps the resume on an existing application. Only the file changes: name,
 * answers, status and any booked interview stay exactly as they were, so the
 * candidate never has to fill the form again.
 */
export async function replaceApplicationResume(
  token: string,
  file: File,
): Promise<ReplaceResumeResult> {
  if (!isResumeUpdateToken(token)) {
    return { ok: false, code: "token", message: "This resume link is not valid." };
  }
  const application = await repository().getApplicationByResumeToken(token);
  if (!application) {
    return { ok: false, code: "token", message: "This resume link is not valid." };
  }
  if (application.status === "rejected") {
    return { ok: false, code: "closed", message: RESUME_UPDATE_REJECTED };
  }
  if (!isResumeUpdateOpen(application)) {
    return { ok: false, code: "expired", message: RESUME_UPDATE_EXPIRED };
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

  const data = Buffer.from(await file.arrayBuffer());
  const stored = await storeResumeFile(
    application.id,
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

  const updatedAt = new Date().toISOString();
  const updated = await repository().replaceApplicationResume(application.id, {
    fileName: file.name,
    text,
    objectPath: stored.objectPath,
    updatedAt,
  });
  if (!updated) {
    return { ok: false, code: "token", message: "This resume link is not valid." };
  }
  return { ok: true, fileName: file.name, updatedAt };
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
