import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { getApplicationResumeFile } from "@/lib/roles/application.service";
import { fetchStoredObject } from "@/lib/storage/gcs";
import { resumeMimeType } from "@/lib/uploads/resume-storage";

type RouteParams = { params: Promise<{ roleId: string; applicationId: string }> };

/**
 * The resume an applicant uploaded. Served from the recordings bucket as the
 * original file; falls back to the extracted text when the file is not stored
 * (local development, or an upload that reached only the database).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, applicationId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId) || !/^app_[A-Za-z0-9_-]{8,64}$/.test(applicationId)) {
    return roleErrorResponse("INVALID_INPUT", "This application ID is invalid.");
  }

  try {
    const resume = await getApplicationResumeFile(roleId, applicationId);
    if (!resume) return roleErrorResponse("ROLE_NOT_FOUND", "No resume is available for this application.");

    const fileName = resume.fileName ?? "resume";
    const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "resume";
    const bucket = process.env.RECORDINGS_GCS_BUCKET?.trim();

    if (resume.objectPath && bucket) {
      const stored = await fetchStoredObject({ bucket, path: resume.objectPath });
      if (stored?.ok) {
        const bytes = await stored.arrayBuffer();
        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type": resumeMimeType(fileName),
            "Content-Disposition": `inline; filename="${safeName}"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
    }

    if (resume.text.trim() !== "") {
      return new NextResponse(resume.text, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeName}.txt"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return roleErrorResponse("ROLE_NOT_FOUND", "The uploaded resume could not be found.");
  } catch (error) {
    console.error(`[applications] resume failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the resume. Please try again.");
  }
}
