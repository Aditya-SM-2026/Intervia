import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import {
  getApplicationScreening,
  screenApplication,
} from "@/lib/screening/screening.service";
import { runAutoInvite } from "@/lib/roles/auto-invite.service";

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

export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId, applicationId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const result = await screenApplication(roleId, applicationId, { force: true });
    if (!result.ok) return roleErrorResponse("ROLE_NOT_FOUND", result.message);
    // A fresh score can put this candidate over the role's automatic invite bar.
    const autoInvite = await runAutoInvite(roleId, {
      origin: publicOrigin(request),
      limit: 1,
    }).catch((error: unknown) => {
      console.error(`[screening] auto-invite failed: ${describeRoleError(error)}`);
      return null;
    });
    return NextResponse.json({ screening: result.snapshot, autoInvite });
  } catch (error) {
    console.error(`[screening] rerun failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not run the screening. Please try again.");
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
