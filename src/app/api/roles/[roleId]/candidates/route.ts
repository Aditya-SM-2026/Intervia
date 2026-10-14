import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { listRoleCandidates, parsePaging } from "@/lib/roles/role.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import type { RoleCandidatesResponse } from "@/lib/roles/role.types";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Candidates of one role (distinct candidate emails), newest interview first.
 * Query: `limit` (max 50), `offset`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }
  const { limit, offset } = parsePaging(
    request.nextUrl.searchParams.get("limit"),
    request.nextUrl.searchParams.get("offset"),
  );

  try {
    const page = await listRoleCandidates(roleId, limit, offset);
    if (!page) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const body: RoleCandidatesResponse = {
      candidates: page.candidates,
      total: page.total,
      limit,
      offset,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[roles] candidates failed: ${describeRoleError(error)}`);
    return roleErrorResponse(
      "SERVER_ERROR",
      "Could not load the candidates. Please try again.",
    );
  }
}