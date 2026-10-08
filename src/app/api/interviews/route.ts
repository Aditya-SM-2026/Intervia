import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createInterviewRoom } from "@/lib/interviews/interview.service";
import {
  createInterviewSchema,
  formatValidationIssues,
} from "@/lib/interviews/interview.validation";
import type { InterviewApiError } from "@/lib/interviews/interview.types";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";

function invalidInput(message: string) {
  const body: InterviewApiError = { error: { code: "INVALID_INPUT", message } };
  return NextResponse.json(body, { status: 400 });
}

/**
 * Creates an interview session. Accepts multipart form data so the resume
 * (PDF) and optionally the job description (PDF) can be uploaded in the same
 * request as the session fields.
 */
export async function POST(request: NextRequest) {
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
    durationMinutes: text("durationMinutes"),
    jobDescriptionText: text("jobDescriptionText"),
  });
  if (!parsed.success) {
    return invalidInput(formatValidationIssues(parsed.error));
  }

  const resumeFile = form.get("resume");
  const jdFile = form.get("jobDescriptionPdf");
  if (!(resumeFile instanceof File) || resumeFile.size === 0) {
    return invalidInput("Resume (PDF) is required.");
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

  let resume: { fileName: string; text: string; unreadable?: boolean };
  try {
    resume = {
      fileName: resumeFile.name,
      text: await extractPdfText(resumeFile, "Resume"),
    };
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      // A scanned or unreadable resume must not block the interview; the
      // brain runs JD-only and the report notes the gap.
      resume = { fileName: resumeFile.name, text: "", unreadable: true };
    } else {
      throw error;
    }
  }

  const room = await createInterviewRoom({
    ...parsed.data,
    jobDescription,
    resume,
  });
  const candidateUrl = new URL(
    `/interview/${room.id}`,
    publicOrigin(request),
  ).toString();

  return NextResponse.json({ room, candidateUrl }, { status: 201 });
}

/**
 * The externally visible origin. Behind a proxy (Cloud Run, tunnels) the
 * Next.js request URL reflects the internal listener, so the forwarded
 * headers take precedence when present.
 */
function publicOrigin(request: NextRequest): string {
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