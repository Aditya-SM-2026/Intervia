import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewRepository } from "@/server/repositories";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import { storeResumeFile } from "@/lib/uploads/resume-storage";
import {
  isUploadLinkValid,
  uploadLinkExpiresAt,
  validateResumeUpload,
} from "@/lib/uploads/resume-upload";

type RouteContext = { params: Promise<{ token: string }> };

/** Minimal, non-sensitive room summary for the public upload page. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  // The token itself is the credential: no other lookup is possible.
  const found = await findByUploadToken(token);
  if (!found) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "This upload link is not valid." } }, { status: 404 });
  }
  const valid = isUploadLinkValid(found);
  return NextResponse.json({
    roleTitle: found.roleTitle,
    recruiterName: found.recruiterName,
    candidateName: found.candidateName,
    scheduledAt: found.scheduledAt,
    valid,
    expiresAt: uploadLinkExpiresAt(found),
    alreadyUsed: Boolean(found.uploadUsedAt),
    resumeReceived: Boolean(found.resume),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const repository = getInterviewRepository();
  const room = await findByUploadToken(token);
  if (!room) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "This upload link is not valid." } }, { status: 404 });
  }
  if (!isUploadLinkValid(room)) {
    const reason = room.uploadUsedAt ? "already_used" : "expired";
    return NextResponse.json(
      { error: { code: "LINK_UNAVAILABLE", message: reason === "already_used" ? "A resume was already uploaded with this link." : "This upload link has expired." } },
      { status: reason === "already_used" ? 409 : 410 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Choose a file to upload." } }, { status: 400 });
  }
  const validation = validateResumeUpload({ name: file.name, size: file.size });
  if (!validation.ok) {
    const messages = {
      empty: "The file is empty.",
      too_large: "The file is larger than 10 MB.",
      unsupported_type: "Only PDF, DOC and DOCX resumes are accepted.",
    } as const;
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: messages[validation.reason] } }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  await storeResumeFile(room.id, validation.kind, data);

  let text = "";
  let unreadable = false;
  if (validation.kind === "pdf") {
    try {
      text = await extractPdfText(file, "Resume");
    } catch (error) {
      if (error instanceof PdfExtractionError) unreadable = true;
      else throw error;
    }
  } else {
    // Word documents are stored for the recruiter but not parsed; the
    // interview runs from the job description.
    unreadable = true;
  }

  const updated = { ...room, resume: { fileName: file.name, text, ...(unreadable ? { unreadable: true } : {}) }, uploadUsedAt: new Date().toISOString() };
  await repository.save(updated);
  await repository.appendEvents(room.id, [
    { type: "resume_uploaded", at: new Date().toISOString(), data: { fileName: file.name, bytes: file.size } },
  ]);

  return NextResponse.json({ ok: true, fileName: file.name });
}

/** Rooms are addressed by their upload token; tokens are stored on the room. */
async function findByUploadToken(token: string) {
  if (!/^[a-z0-9]{32}$/.test(token)) return null;
  const repository = getInterviewRepository();
  const rooms = await repository.list({});
  return rooms.find((room) => room.uploadToken === token && room.status !== "completed") ?? null;
}