import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { clampCutoff } from "@/lib/roles/shortlist";
import { getRolesRepository } from "@/server/repositories/roles-repository";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Shortlisting by Match score. The cutoff is one number per role; the manual
 * tick per candidate lives at `POST { applicationId, shortlisted }`. Neither
 * rejects anybody: they only decide what the Shortlist column shows.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const role = await getRolesRepository().getRole(roleId);
    if (!role) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const cutoff = await getRolesRepository().getRoleShortlistCutoff(roleId);
    return NextResponse.json({ cutoff });
  } catch (error) {
    console.error(`[shortlist] loading the cutoff failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the shortlist setting.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as
    | { cutoff?: unknown; applicationId?: unknown; shortlisted?: unknown }
    | null;
  if (!body) {
    return roleErrorResponse("INVALID_INPUT", "Send the shortlist change to save.");
  }

  try {
    const role = await getRolesRepository().getRole(roleId);
    if (!role) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");

    if (typeof body.applicationId === "string") {
      if (typeof body.shortlisted !== "boolean" && body.shortlisted !== null) {
        return roleErrorResponse("INVALID_INPUT", "Send shortlisted as true, false or null.");
      }
      const saved = await getRolesRepository().setApplicationShortlisted(
        roleId,
        body.applicationId,
        body.shortlisted as boolean | null,
      );
      if (!saved) {
        return roleErrorResponse("INVALID_INPUT", "This application does not exist on this role.");
      }
      return NextResponse.json({ ok: true });
    }

    const cutoff = Number(body.cutoff);
    if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 100) {
      return roleErrorResponse("INVALID_INPUT", "The cutoff must be a score between 0 and 100.");
    }
    const saved = await getRolesRepository().setRoleShortlistCutoff(roleId, clampCutoff(cutoff));
    return NextResponse.json({ cutoff: saved });
  } catch (error) {
    console.error(`[shortlist] saving failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not save the shortlist change.");
  }
}
