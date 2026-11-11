import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  getScreeningSettings,
  saveScreeningSettings,
} from "@/lib/screening/screening.service";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Resume screening settings for one role: whether it runs, and the six section
 * weights. Weights only change how existing section scores add up, so saving
 * them never triggers a model call.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const settings = await getScreeningSettings(roleId);
    if (!settings) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json(settings);
  } catch (error) {
    console.error(`[screening] settings failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the screening settings.");
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
    | { enabled?: unknown; weights?: unknown }
    | null;
  if (!body) {
    return roleErrorResponse("INVALID_INPUT", "Send the settings to save.");
  }

  try {
    const saved = await saveScreeningSettings(roleId, body);
    if (!saved.ok) {
      return saved.code === "not_found"
        ? roleErrorResponse("ROLE_NOT_FOUND", saved.message)
        : roleErrorResponse("INVALID_INPUT", saved.message);
    }
    return NextResponse.json(saved.settings);
  } catch (error) {
    console.error(`[screening] saving settings failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not save the screening settings.");
  }
}
