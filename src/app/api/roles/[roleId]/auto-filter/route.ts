import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { getRoleAutoFilterRule, setRoleAutoFilterRule } from "@/lib/roles/role.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * The role's automatic filtration rule: which Match score and CGPA make a
 * candidate eligible for the automatic filter. HR edits both numbers; this is
 * the read half.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const rule = await getRoleAutoFilterRule(roleId);
    if (!rule) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ rule });
  } catch (error) {
    console.error(`[roles] auto filter read failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the filter rule. Please try again.");
  }
}

/** Body: `{ matchBelow, cgpaBelow }`. Values outside 0-100 are clamped. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "Send the filter rule as JSON.");
  }

  try {
    const rule = await setRoleAutoFilterRule(roleId, body);
    if (!rule) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ rule });
  } catch (error) {
    console.error(`[roles] auto filter save failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not save the filter rule. Please try again.");
  }
}
