import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { getAutoInviteState, runAutoInvite } from "@/lib/roles/auto-invite.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Sends the invitations that are due now, up to a small batch. Used by the
 * "Run now" button and safe to press twice: each application records its one
 * attempt, so nobody is invited twice.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  try {
    const result = await runAutoInvite(roleId, { origin: publicOrigin(request) });
    if (!result) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    const state = await getAutoInviteState(roleId);
    return NextResponse.json({ ...result, state });
  } catch (error) {
    console.error(`[auto-invite] run failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not send the invitations.");
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
