import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { getCandidateResume } from "@/lib/roles/role.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";

type RouteParams = { params: Promise<{ roleId: string; candidateId: string }> };

/**
 * The candidate's stored resume text as a plain-text download. Scoped to the
 * role and the candidate; 404 when no resume text was ever captured.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, candidateId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }
  let decodedId: string;
  try {
    decodedId = decodeURIComponent(candidateId).trim().toLowerCase();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "This candidate ID is invalid.");
  }

  try {
    const resume = await getCandidateResume(roleId, decodedId);
    if (!resume) {
      return roleErrorResponse("ROLE_NOT_FOUND", "No resume is available for this candidate.");
    }
    const safeName =
      resume.fileName?.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "resume.txt";
    return new NextResponse(resume.text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName.endsWith(".txt") ? safeName : `${safeName}.txt`}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[roles] resume failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the resume. Please try again.");
  }
}