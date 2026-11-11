import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  screenPendingBatch,
  screeningEstimate,
} from "@/lib/screening/screening.service";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Screens applications that have no result yet, in small batches so a request
 * never runs longer than a Cloud Run timeout. Send `estimateOnly` first: the
 * recruiter sees the count and the rough bill before anything is spent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as
    | { estimateOnly?: unknown; limit?: unknown }
    | null;

  try {
    if (body?.estimateOnly === true) {
      const estimate = await screeningEstimate(roleId);
      if (!estimate) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
      return NextResponse.json(estimate);
    }

    const limit = typeof body?.limit === "number" ? Math.min(Math.max(Math.round(body.limit), 1), 25) : 10;
    const result = await screenPendingBatch(roleId, limit);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[screening] backfill failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not screen the applications. Please try again.");
  }
}
