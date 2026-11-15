import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { actorFromCookieValue } from "@/lib/auth/actor";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Sends signed-out visitors to the sign-in page before any recruiter page
 * renders. The proxy runs on the Node.js runtime, so it checks the stored
 * session: an ended session or a turned-off account is stopped here too. The
 * APIs behind those pages enforce the same check themselves
 * (src/lib/auth/guards.ts); this is the fast path, not the only one.
 */
export async function proxy(request: NextRequest) {
  if (await actorFromCookieValue(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/recruiter/:path*", "/dashboard/:path*"],
};
