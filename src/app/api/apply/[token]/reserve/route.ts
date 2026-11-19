import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { reserveApplicationSlot } from "@/lib/roles/application.service";
import { allowAttempt, clientIp } from "@/lib/roles/apply-rate-limit";

type RouteContext = { params: Promise<{ token: string }> };

const HOUR_MS = 60 * 60_000;

/**
 * A whole campus can share one public IP, so the per-IP allowance here is only
 * a flood backstop. Ordering and pacing come from the atomic slot reservation.
 */
const RESERVE_MAX_PER_IP = 5_000;

/** Hands out the next submission slot for a public form token. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  if (!allowAttempt(`reserve:${clientIp(request)}`, RESERVE_MAX_PER_IP, HOUR_MS)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests from this network. Please try again later.",
        },
      },
      { status: 429 },
    );
  }

  const result = await reserveApplicationSlot(token);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code.toUpperCase(), message: result.message } },
      { status: result.code === "closed" ? 410 : 404 },
    );
  }

  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
