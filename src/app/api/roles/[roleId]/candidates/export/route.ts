import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { exportRoleCandidates } from "@/lib/roles/role.service";
import {
  buildRoleCandidatesCsv,
  exportFileName,
} from "@/lib/roles/roles-csv";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * CSV export of every candidate in the role with their available scores.
 * All matching rows are included (not only the page on screen); missing
 * scores stay empty and pending evaluations are labelled, never invented.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const exported = await exportRoleCandidates(roleId);
    if (!exported) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const candidates = exported.candidates.map((row) => ({
      candidateId: row.candidateId,
      candidateEmail: row.candidateEmail,
      candidateName: row.candidateName,
      interviews: row.interviews,
      completed: row.completed,
      pending: row.interviews - row.completed,
      latestInterviewId: row.roomId,
      latestInterviewAt: row.latestInterviewAt,
      latestStatus: row.latestStatus,
      overallScore: row.overallScore,
      suggestion: row.suggestion,
      decision: row.decision,
    }));
    const csv = buildRoleCandidatesCsv(
      {
        roleId: exported.role.id,
        roleTitle: exported.role.title,
        roleStatus: exported.role.status,
      },
      candidates,
    );
    const filename = exportFileName(exported.role.title, new Date());
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[roles] export failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not export the candidates. Please try again.");
  }
}