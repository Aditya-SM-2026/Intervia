import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  getApplicationScreening,
  screenApplication,
} from "@/lib/screening/screening.service";

type RouteParams = { params: Promise<{ roleId: string; applicationId: string }> };

/** GET the stored screening result; POST re-runs it for this application. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, applicationId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const screening = await getApplicationScreening(roleId, applicationId);
    return NextResponse.json({ screening });
  } catch (error) {
    console.error(`[screening] reading result failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load this screening.");
  }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, applicationId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const result = await screenApplication(roleId, applicationId, { force: true });
    if (!result.ok) return roleErrorResponse("ROLE_NOT_FOUND", result.message);
    return NextResponse.json({ screening: result.snapshot });
  } catch (error) {
    console.error(`[screening] rerun failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not run the screening. Please try again.");
  }
}
