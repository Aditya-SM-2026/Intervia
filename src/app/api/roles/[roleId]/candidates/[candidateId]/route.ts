import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { getCandidateDetail } from "@/lib/roles/role.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import type { RoleCandidateResponse } from "@/lib/roles/role.types";

type RouteParams = { params: Promise<{ roleId: string; candidateId: string }> };

/** One candidate inside one role: identity, interviews and their scores. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, candidateId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }
  // The candidate id is an email address; decodeURIComponent first.
  let decodedId: string;
  try {
    decodedId = decodeURIComponent(candidateId).trim().toLowerCase();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "This candidate ID is invalid.");
  }

  try {
    const candidate = await getCandidateDetail(roleId, decodedId);
    if (!candidate) {
      return roleErrorResponse(
        "ROLE_NOT_FOUND",
        "This candidate does not exist in this role.",
      );
    }
    const body: RoleCandidateResponse = { candidate };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[roles] candidate failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the candidate. Please try again.");
  }
}