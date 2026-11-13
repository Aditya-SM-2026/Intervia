import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import {
  getAutoInviteState,
  saveAutoInviteSettings,
} from "@/lib/roles/auto-invite.service";
import { isAutoInviteEmail } from "@/lib/roles/auto-invite";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * The role's automatic-invitation setting: whether it runs, the Match bar, the
 * interview setup, how many candidates are waiting, and the last invitations.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const state = await getAutoInviteState(roleId);
    if (!state) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json(state);
  } catch (error) {
    console.error(`[auto-invite] state failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the automatic invitation setting.");
  }
}

/**
 * Saves the setting. Turning automation on does not send anything by itself:
 * the sender runs after each screening result and on "Run now", so HR can set
 * the bar and the interview length up before anyone is emailed.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return roleErrorResponse("INVALID_INPUT", "Send the settings to save.");
  }
  if (typeof body.hrEmail === "string" && body.hrEmail.trim() !== "" && !isAutoInviteEmail(body.hrEmail.trim())) {
    return roleErrorResponse("INVALID_INPUT", "Enter a valid email address for the HR copy.");
  }

  try {
    const settings = await saveAutoInviteSettings(roleId, body);
    if (!settings) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json({ settings });
  } catch (error) {
    console.error(`[auto-invite] save failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not save the automatic invitation setting.");
  }
}
