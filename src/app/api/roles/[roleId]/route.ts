import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ZodError } from "zod";
import { getRoleSummary, deleteRoles, updateRole } from "@/lib/roles/role.service";
import { formatRoleValidationIssues } from "@/lib/roles/role.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import type { RoleResponse } from "@/lib/roles/role.types";

type RouteParams = { params: Promise<{ roleId: string }> };

function validRoleId(roleId: string): boolean {
  return ROOM_ID_PATTERN.test(roleId);
}

/** One role with its live candidate statistics. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!validRoleId(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const role = await getRoleSummary(roleId);
    if (!role) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const body: RoleResponse = { role };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[roles] get failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the role. Please try again.");
  }
}

/** Updates role fields or transitions the status (e.g. mark completed). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!validRoleId(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }

  try {
    const role = await updateRole(roleId, payload);
    if (!role) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ role });
  } catch (error) {
    if (error instanceof ZodError) {
      return roleErrorResponse("INVALID_INPUT", formatRoleValidationIssues(error));
    }
    console.error(`[roles] update failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not update the role. Please try again.");
  }
}

/**
 * Deletes one role together with its candidate interviews, so the candidates
 * disappear from the dashboard as well as the roles page.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!validRoleId(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const result = await deleteRoles([roleId]);
    if (result.roles === 0) {
      return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    }
    return NextResponse.json({ deleted: result.roles, interviews: result.interviews });
  } catch (error) {
    console.error(`[roles] delete failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not delete the role. Please try again.");
  }
}