import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { MAX_RESPONSE_BYTES, clampRange } from "@/lib/recordings/store";
import { fetchStoredObject } from "@/lib/storage/gcs";
import { resumeMimeType } from "@/lib/uploads/resume-storage";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * The candidate's original resume, as the recruiter uploaded it (or as the
 * candidate sent it through the upload link). PDFs open in the browser; Word
 * documents download. Interviews recorded before originals were kept fall
 * back to the extracted text.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  const room = await getInterviewRepository().get(roomId);
  const resume = room?.resume;
  if (!resume) {
    return interviewErrorResponse("ROOM_NOT_FOUND", "This interview has no resume.");
  }

  const fileName =
    resume.fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "resume.pdf";
  const bucket = process.env.RECORDINGS_GCS_BUCKET?.trim();
  const range = request.headers.get("range");

  if (resume.objectPath && bucket) {
    const stored = await fetchStoredObject(
      { bucket, path: resume.objectPath },
      { range: clampRange(range) ?? `bytes=0-${MAX_RESPONSE_BYTES - 1}` },
    );
    if (stored && (stored.ok || stored.status === 206)) {
      const mimeType = resumeMimeType(resume.fileName);
      const headers = new Headers({
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${
          mimeType === "application/pdf" ? "inline" : "attachment"
        }; filename="${fileName}"`,
      });
      for (const name of ["content-length", "content-range"]) {
        const value = stored.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new NextResponse(stored.body, { status: stored.status, headers });
    }
  }

  if (resume.text) {
    // Older interviews kept only the extracted text; show it rather than a 404.
    return new NextResponse(resume.text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${fileName.replace(/\.[a-z0-9]+$/i, "")}.txt"`,
      },
    });
  }

  return interviewErrorResponse("ROOM_NOT_FOUND", "The original resume was not kept for this interview.");
}
