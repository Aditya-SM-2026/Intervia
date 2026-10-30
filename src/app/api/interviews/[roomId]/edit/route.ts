import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import {
  getInterviewEditState,
  updateScheduledInterview,
} from "@/lib/interviews/interview.service";
import {
  createInterviewSchema,
  formatValidationIssues,
  roomIdSchema,
} from "@/lib/interviews/interview.validation";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import type { JobDescription, ResumeInfo } from "@/lib/interviews/interview.types";
import { ensureRoleForTitle } from "@/lib/roles/role.service";
import { describeRoleError } from "@/lib/roles/role-errors";
import { sendInterviewUpdate } from "@/lib/emails/email.service";

type RouteParams = { params: Promise<{ roomId: string }> };

function invalidInput(message: string) {
  return interviewErrorResponse("INVALID_INPUT", message);
}

/**
 * Edits an interview that has not started yet (recruiters only). Accepts the
 * same multipart fields as creation: text fields always, PDFs when the
 * recruiter replaces them. A saved change rebuilds the plan when it affects
 * the questions, extends the link, and emails the candidate a summary of what
 * changed with the link to use.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return invalidInput("This interview link is invalid.");
  }

  const state = await getInterviewEditState(roomId);
  if (!state) return interviewErrorResponse("ROOM_NOT_FOUND", "This interview does not exist.");
  if (!state.editable) {
    return interviewErrorResponse(
      "ROOM_UNAVAILABLE",
      state.reason ?? "This interview can no longer be edited.",
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalidInput("Request must be multipart form data.");
  }

  const text = (key: string): string | undefined => {
    const value = form.get(key);
    return typeof value === "string" ? value : undefined;
  };

  const parsed = createInterviewSchema.safeParse({
    recruiterName: text("recruiterName"),
    candidateName: text("candidateName"),
    candidateEmail: text("candidateEmail"),
    roleTitle: text("roleTitle"),
    durationMinutes: text("durationMinutes"),
    difficulty: text("difficulty"),
    jobDescriptionText: text("jobDescriptionText"),
  });
  if (!parsed.success) return invalidInput(formatValidationIssues(parsed.error));

  const jdFile = form.get("jobDescriptionPdf");
  if (jdFile !== null && !(jdFile instanceof File)) {
    return invalidInput("Job description upload must be a file.");
  }

  let jobDescription: JobDescription | null = null;
  if (jdFile instanceof File && jdFile.size > 0) {
    if (parsed.data.jobDescriptionText) {
      return invalidInput("Provide the job description as text or as a PDF, not both.");
    }
    try {
      jobDescription = { source: "pdf", text: await extractPdfText(jdFile, "Job description") };
    } catch (error) {
      if (error instanceof PdfExtractionError) return invalidInput(error.message);
      throw error;
    }
  } else if (parsed.data.jobDescriptionText) {
    jobDescription = { source: "text", text: parsed.data.jobDescriptionText };
  } else {
    return invalidInput("A job description is required: paste text or upload a PDF.");
  }

  const resumeFile = form.get("resume");
  if (resumeFile !== null && (!(resumeFile instanceof File) || resumeFile.size === 0)) {
    return invalidInput("The resume upload must be a non-empty file.");
  }

  let resume: ResumeInfo | null = null;
  if (resumeFile instanceof File && resumeFile.size > 0) {
    try {
      resume = { fileName: resumeFile.name, text: await extractPdfText(resumeFile, "Resume") };
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        resume = { fileName: resumeFile.name, text: "", unreadable: true };
      } else {
        throw error;
      }
    }
  }

  const result = await updateScheduledInterview(roomId, {
    recruiterName: parsed.data.recruiterName,
    candidateName: parsed.data.candidateName,
    candidateEmail: parsed.data.candidateEmail,
    roleTitle: parsed.data.roleTitle,
    durationMinutes: parsed.data.durationMinutes,
    difficulty: parsed.data.difficulty,
    jobDescription,
    resume,
  });

  if (!result.ok) return interviewErrorResponse(result.code, result.message);

  const { room, changes } = result;
  const candidateUrl = new URL(`/interview/${room.id}`, publicOrigin(request)).toString();

  try {
    await ensureRoleForTitle(parsed.data.roleTitle);
  } catch (error) {
    console.error(`[interviews] role auto-create failed for edit: ${describeRoleError(error)}`);
  }

  // Nothing changed: no email, no new validity window beyond what the save
  // already refreshed. The screen says so instead.
  const inviteEmail =
    changes.length > 0
      ? await sendInterviewUpdate({
          to: room.candidateEmail ?? parsed.data.candidateEmail,
          candidateName: room.candidateName ?? parsed.data.candidateName,
          roleTitle: room.roleTitle ?? parsed.data.roleTitle,
          recruiterName: room.recruiterName,
          candidateUrl,
          scheduledAt: room.scheduledAt,
          expiresAt: room.expiresAt,
          durationMinutes: room.durationMinutes,
          changes,
        })
      : null;

  return NextResponse.json({ room, candidateUrl, changes, inviteEmail });
}

/** Mirrors the create route: forwarded headers win behind Cloud Run. */
function publicOrigin(request: NextRequest): string {
  const configured = process.env.INTERVIA_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const safeHost = /^[a-zA-Z0-9.\-:]+$/.test(host) ? host : "localhost";
  return `${proto}://${safeHost}`;
}
