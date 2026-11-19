import { clientAddress } from "@/lib/auth/accounts.logic";
import {
  overRateLimits,
  rateLimitedMessage,
  rateLimitKey,
} from "@/lib/http/rate-limit";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { reserveApplicationSlot } from "@/lib/roles/application.service";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Reserving is cheap, but each reservation advances the queue, so it gets its
 * own shared backstop. It has to sit above the size of a campus drive: a whole
 * college can share one public address.
 */
const RESERVES_PER_HOUR_PER_ADDRESS = 5_000;
const RESERVES_PER_HOUR_PER_LINK = 10_000;

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: rateLimitedMessage(retryAfterSeconds) } },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/** Hands out the next submission slot for a public form token. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const address = clientAddress(request.headers.get("x-forwarded-for"));

  const limit = await overRateLimits([
    {
      key: rateLimitKey(["apply", "reserve", "ip", address]),
      limit: RESERVES_PER_HOUR_PER_ADDRESS,
      windowSeconds: 3600,
    },
    {
      key: rateLimitKey(["apply", "reserve", "link", token]),
      limit: RESERVES_PER_HOUR_PER_LINK,
      windowSeconds: 3600,
    },
  ]);
  if (limit.limited) return rateLimited(limit.retryAfterSeconds);

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
