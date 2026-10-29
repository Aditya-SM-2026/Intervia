import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createInterviewRoom, findDuplicateInterview, resolveScheduledAt } from "@/lib/interviews/interview.service";
import { DuplicateInterviewError } from "@/lib/interviews/interview-errors";
import {
  createInterviewSchema,
  formatValidationIssues,
} from "@/lib/interviews/interview.validation";
import type { InterviewApiError } from "@/lib/interviews/interview.types";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import { requireRecruiter } from "@/lib/auth/guards";
import { ensureRoleForTitle } from "@/lib/roles/role.service";
import { describeRoleError } from "@/lib/roles/role-errors";
import { storeResumeFile } from "@/lib/uploads/resume-storage";
import { getInterviewRepository } from "@/server/repositories";
import {
  invitationInputFromRoom,
  sendInterviewInvitation,
} from "@/lib/emails/email.service";

function invalidInput(message: string) {
  const body: InterviewApiError = { error: { code: "INVALID_INPUT", message } };
  return NextResponse.json(body, { status: 400 });
}

/**
 * Creates an interview session (signed-in recruiters only). Accepts multipart
 * form data so the resume (PDF) and optionally the job description (PDF) can
 * be uploaded in the same request as the session fields. The interview plan
 * is generated here, so the response takes a few seconds.
 */
export async function POST(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

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
    title: text("title"),
    recruiterName: text("recruiterName"),
    candidateName: text("candidateName"),
    candidateEmail: text("candidateEmail"),
    roleTitle: text("roleTitle"),
    scheduledDate: text("scheduledDate"),
    scheduledTime: text("scheduledTime"),
    durationMinutes: text("durationMinutes"),
    difficulty: text("difficulty"),
    voiceMode: text("voiceMode"),
    jobDescriptionText: text("jobDescriptionText"),
  });
  if (!parsed.success) {
    return invalidInput(formatValidationIssues(parsed.error));
  }

  const scheduled = resolveScheduledAt(parsed.data.scheduledDate, parsed.data.scheduledTime);
  if (scheduled.error) return invalidInput(scheduled.error);

  // An accidental re-submit must return the earlier interview, not a second
  // one — checked before the plan is generated, which takes seconds.
  const duplicate = await findDuplicateInterview(
    { candidateEmail: parsed.data.candidateEmail, roleTitle: parsed.data.roleTitle },
    scheduled.value,
  );
  if (duplicate) {
    const candidateUrl = new URL(`/interview/${duplicate.id}`, publicOrigin(request)).toString();
    return NextResponse.json(
      {
        room: duplicate,
        candidateUrl,
        duplicate: true,
        error: { code: "DUPLICATE_INTERVIEW", message: "This exact interview is already scheduled." },
      },
      { status: 409 },
    );
  }

  const resumeFile = form.get("resume");
  const jdFile = form.get("jobDescriptionPdf");
  // The resume is optional: when the recruiter has none at hand, the
  // candidate can upload it through the one-time upload link instead.
  if (resumeFile !== null && (!(resumeFile instanceof File) || resumeFile.size === 0)) {
    return invalidInput("The resume upload must be a non-empty file.");
  }
  if (jdFile !== null && !(jdFile instanceof File)) {
    return invalidInput("Job description upload must be a file.");
  }

  let jobDescription: { source: "text" | "pdf"; text: string } | null = null;
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

  let resume: { fileName: string; text: string; unreadable?: boolean } | null = null;
  if (resumeFile instanceof File && resumeFile.size > 0) {
    try {
      resume = {
        fileName: resumeFile.name,
        text: await extractPdfText(resumeFile, "Resume"),
      };
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        // A scanned or unreadable resume must not block the interview; the
        // plan is built from the job description alone and the scorecard notes it.
        resume = { fileName: resumeFile.name, text: "", unreadable: true };
      } else {
        throw error;
      }
    }
  }

  let room;
  try {
    room = await createInterviewRoom({
      ...parsed.data,
      scheduledAt: scheduled.value,
      jobDescription,
      resume,
    });
  } catch (error) {
    if (error instanceof DuplicateInterviewError) {
      // Lost the insert race against an identical simultaneous submission.
      const candidateUrl = new URL(`/interview/${error.room.id}`, publicOrigin(request)).toString();
      return NextResponse.json(
        {
          room: error.room,
          candidateUrl,
          duplicate: true,
          error: { code: "DUPLICATE_INTERVIEW", message: "This exact interview is already scheduled." },
        },
        { status: 409 },
      );
    }
    throw error;
  }
  // Keep the recruiter's own copy of the resume, so "View resume" opens the
  // file they uploaded rather than only the text extracted from it. Best
  // effort: a storage failure must not fail the interview.
  if (resumeFile instanceof File && resumeFile.size > 0 && room.resume) {
    try {
      const extension = resumeFile.name.toLowerCase().split(".").pop();
      const kind = extension === "doc" || extension === "docx" ? extension : "pdf";
      const stored = await storeResumeFile(
        room.id,
        kind,
        Buffer.from(await resumeFile.arrayBuffer()),
        resumeFile.name,
      );
      if (stored.objectPath) {
        room.resume = { ...room.resume, objectPath: stored.objectPath };
        await getInterviewRepository().save(room);
      }
    } catch (error) {
      console.error(`[interviews] resume copy failed: ${describeRoleError(error)}`);
    }
  }
  // Every role a recruiter hires for must be visible on the roles page: if
  // this interview introduced a new role title, create the role record for
  // it. Best-effort — a failure here must not fail the interview creation.
  try {
    await ensureRoleForTitle(parsed.data.roleTitle);
  } catch (error) {
    console.error(`[interviews] role auto-create failed: ${describeRoleError(error)}`);
  }
  const candidateUrl = new URL(
    `/interview/${room.id}`,
    publicOrigin(request),
  ).toString();

  // The invitation must never block scheduling: the send reports its own
  // status and swallows SMTP errors.
  const inviteEmail = await sendInterviewInvitation(
    invitationInputFromRoom(room, candidateUrl),
  );

  const uploadUrl = room.uploadToken
    ? new URL(`/upload/${room.uploadToken}`, publicOrigin(request)).toString()
    : null;

  return NextResponse.json({ room, candidateUrl, uploadUrl, inviteEmail }, { status: 201 });
}

/**
 * The externally visible origin. Behind a proxy (Cloud Run, tunnels) the
 * Next.js request URL reflects the internal listener, so the forwarded
 * headers take precedence when present.
 */
function publicOrigin(request: NextRequest): string {
  // An explicitly configured origin wins: behind Cloud Run the forwarded
  // headers are usually right, but a pinned value can never drift.
  const configured = process.env.INTERVIA_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const safeHost = /^[a-zA-Z0-9.\-:]+$/.test(host) ? host : "localhost";
  return `${proto}://${safeHost}`;
}