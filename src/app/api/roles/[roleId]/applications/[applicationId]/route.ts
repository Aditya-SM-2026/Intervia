import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { decideApplication } from "@/lib/roles/application.service";

type RouteParams = { params: Promise<{ roleId: string; applicationId: string }> };

const ACTIONS = new Set(["reject", "restore", "scheduled"]);

/**
 * Moves one application between Waiting and Rejected, or records the
 * interview booked from it. Stage on the role table follows this.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, applicationId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId) || !/^app_[A-Za-z0-9_-]{8,64}$/.test(applicationId)) {
    return roleErrorResponse("INVALID_INPUT", "This application ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; interviewId?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return roleErrorResponse("INVALID_INPUT", "Choose reject, restore or scheduled.");
  }
  const interviewId =
    typeof body?.interviewId === "string" && ROOM_ID_PATTERN.test(body.interviewId)
      ? body.interviewId
      : null;

  try {
    const application = await decideApplication(
      roleId,
      applicationId,
      action as "reject" | "restore" | "scheduled",
      interviewId,
    );
    if (!application) return roleErrorResponse("ROLE_NOT_FOUND", "This application no longer exists.");
    return NextResponse.json({ application });
  } catch (error) {
    console.error(`[applications] update failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not update the application. Please try again.");
  }
}
