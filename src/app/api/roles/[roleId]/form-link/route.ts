import { logActivity } from "@/lib/activity/activity";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  getRoleFormLink,
  readRoleFormFields,
  reEnableRoleFormLink,
  revokeRoleFormLink,
  rotateRoleFormLink,
  saveApplicationFields,
  saveFormLinkSettings,
} from "@/lib/roles/application.service";
import { ZodError } from "zod";
import { formatRoleValidationIssues } from "@/lib/roles/role.validation";
import { resolveAppOrigin } from "@/lib/http/app-origin";

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

  const body = (await request.json().catch(() => null)) as
    | {
        fields?: unknown;
        settings?: unknown;
        rotate?: unknown;
        reenable?: unknown;
      }
    | null;
  // Behind Cloud Run the request's own origin is 0.0.0.0:8080, which is not a
  // link anyone can open. Resolve the public base URL instead.
  const origin = resolveAppOrigin({
    configured: process.env.APP_BASE_URL,
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    proto: request.headers.get("x-forwarded-proto"),
    fallback: request.nextUrl.origin,
  });

  try {
    let link;
    if (body && body.rotate === true) {
      link = await rotateRoleFormLink(roleId, origin);
    } else if (body && body.reenable === true) {
      link = await reEnableRoleFormLink(roleId, origin);
    } else if (body && body.settings !== undefined) {
      const settings = (body.settings ?? {}) as {
        maxApplications?: unknown;
        expiresAfterHours?: unknown;
      };
      link = await saveFormLinkSettings(roleId, settings, origin);
    } else if (body && "fields" in body) {
      link = await saveApplicationFields(roleId, body.fields, origin);
    } else {
      link = await getRoleFormLink(roleId, origin);
    }
    if (!link) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    // Opening a role page also calls this (to make sure a link exists); only
    // real changes are recorded.
    const change = body?.rotate === true ? "made a new application link" : body?.reenable === true ? "reopened the application form"
      : body && body.settings !== undefined ? "changed the application form limits" : body && "fields" in body ? "edited the application form questions" : null;
    if (change) await logActivity({ action: "role.form_changed", targetType: "role", targetId: roleId, summary: `${change.charAt(0).toUpperCase()}${change.slice(1)}` });
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
    await logActivity({ action: "role.form_closed", targetType: "role", targetId: roleId, summary: "Closed the application form link" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[applications] revoke failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not turn the form link off. Please try again.");
  }
}
