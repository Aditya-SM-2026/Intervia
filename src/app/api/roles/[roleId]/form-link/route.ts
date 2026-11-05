import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  getRoleFormLink,
  readRoleFormFields,
  revokeRoleFormLink,
  saveApplicationFields,
} from "@/lib/roles/application.service";
import { ZodError } from "zod";
import { formatRoleValidationIssues } from "@/lib/roles/role.validation";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * The role's public application form link. POST creates the link the first
 * time (and saves questions when they are sent), DELETE revokes it. The token
 * is the credential for /apply/<token>, so it is only ever handed to a
 * signed-in recruiter here.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const fields = await readRoleFormFields(roleId);
    if (fields === null) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ fields });
  } catch (error) {
    console.error(`[applications] form fields failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the form. Please try again.");
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as { fields?: unknown } | null;
  const origin = request.nextUrl.origin;

  try {
    const link =
      body && "fields" in body
        ? await saveApplicationFields(roleId, body.fields, origin)
        : await getRoleFormLink(roleId, origin);
    if (!link) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json(link);
  } catch (error) {
    if (error instanceof ZodError) {
      return roleErrorResponse("INVALID_INPUT", formatRoleValidationIssues(error));
    }
    console.error(`[applications] form link failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not prepare the form link. Please try again.");
  }
}

/** Turns the link off; applications already collected stay in the role. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const revoked = await revokeRoleFormLink(roleId);
    if (!revoked) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[applications] revoke failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not turn the form link off. Please try again.");
  }
}
