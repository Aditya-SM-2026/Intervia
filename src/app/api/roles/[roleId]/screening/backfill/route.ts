import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  screenPendingBatch,
  screeningEstimate,
} from "@/lib/screening/screening.service";
import { runAutoInvite } from "@/lib/roles/auto-invite.service";

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
    // A screening run is the moment a candidate can cross the role's Match bar.
    // Send what is due now; the periodic scan catches applications that were
    // screened in the background after someone applied.
    const autoInvite = await runAutoInvite(roleId, {
      origin: publicOrigin(request),
      limit: 3,
    }).catch((error: unknown) => {
      console.error(`[screening] auto-invite failed: ${describeRoleError(error)}`);
      return null;
    });
    return NextResponse.json({ ...result, autoInvite });
  } catch (error) {
    console.error(`[screening] backfill failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not screen the applications. Please try again.");
  }
}

/** The externally visible origin; forwarded headers win behind a proxy. */
function publicOrigin(request: NextRequest): string {
  const configured = process.env.INTERVIA_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const safeHost = /^[a-zA-Z0-9.\-:]+$/.test(host) ? host : "localhost";
  return `${proto}://${safeHost}`;
}
