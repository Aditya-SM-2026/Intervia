import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAgentApiSecret, isProduction } from "@/lib/config/env";
import { getActor } from "./actor";
import { isAdmin } from "./accounts.logic";

/**
 * Route-handler guards. The proxy already redirects unauthenticated page
 * loads, but every recruiter and agent API checks again here: a proxy matcher
 * is easy to get wrong, and this data (resumes, transcripts) must not depend
 * on it.
 */

/** Returns a 401 response when the caller is not a signed-in recruiter. */
export async function requireRecruiter(): Promise<NextResponse | null> {
  if (await getActor()) return null;
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Sign in to continue." } },
    { status: 401 },
  );
}

/**
 * Returns 401 when signed out and 403 for team members: managing the team
 * and reading the activity log are for the admin login only.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const actor = await getActor();
  if (!actor) return requireRecruiter();
  if (isAdmin(actor)) return null;
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message: "Only the admin can do this." } },
    { status: 403 },
  );
}

/** Returns a 401 response unless the caller presents the agent secret. */
export function requireAgent(request: NextRequest): NextResponse | null {
  const secret = getAgentApiSecret();
  if (!secret) {
    // Without a configured secret the agent API only answers in development.
    if (!isProduction()) return null;
  } else {
    const header = request.headers.get("authorization") ?? "";
    const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    const expected = Buffer.from(secret);
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
      return null;
    }
  }
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Invalid agent credentials." } },
    { status: 401 },
  );
}
