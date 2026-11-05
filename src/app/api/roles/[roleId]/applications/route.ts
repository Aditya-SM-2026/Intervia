import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { listRoleApplications } from "@/lib/roles/application.service";
import type { RoleApplicationsResponse } from "@/lib/roles/application.types";

type RouteParams = { params: Promise<{ roleId: string }> };

/** Applications collected by the role's public form, newest first. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const offset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "", 10);

  try {
    const page = await listRoleApplications(
      roleId,
      Number.isFinite(limit) ? limit : 50,
      Number.isFinite(offset) ? offset : 0,
    );
    if (!page) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const body: RoleApplicationsResponse = page;
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[applications] list failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the applications. Please try again.");
  }
}
