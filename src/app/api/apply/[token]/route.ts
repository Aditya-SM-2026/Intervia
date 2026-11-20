import { clientAddress } from "@/lib/auth/accounts.logic";
import {
  overRateLimits,
  rateLimitedMessage,
  rateLimitKey,
} from "@/lib/http/rate-limit";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getPublicApplicationState,
  submitApplication,
} from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Limits for the public form. Counts are shared across every instance, so
 * these numbers are the real ceiling rather than a per-instance one.
 *
 * The per-address numbers are generous on purpose: a college lab, or a whole
 * office, can put a hundred candidates behind one public address. Duplicates
 * are stopped by the per-email limit instead.
 */
const FORM_LOADS_PER_MINUTE = 120;
const SUBMISSIONS_PER_HOUR_PER_ADDRESS = 300;
const SUBMISSIONS_PER_HOUR_PER_EMAIL = 10;
const SUBMISSIONS_PER_HOUR_PER_LINK = 2000;

/** The last X-Forwarded-For entry: the address Google saw, not one the client chose. */
function clientIp(request: NextRequest): string {
  return clientAddress(request.headers.get("x-forwarded-for"));
}

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: rateLimitedMessage(retryAfterSeconds) } },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/** What the public form needs: the role, its description and its questions. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  const limit = await overRateLimits([
    {
      key: rateLimitKey(["apply", "load", clientIp(request), token]),
      limit: FORM_LOADS_PER_MINUTE,
      windowSeconds: 60,
    },
  ]);
  if (limit.limited) return rateLimited(limit.retryAfterSeconds);

  const state = await getPublicApplicationState(token);
  if (!state.form) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: closedReasonMessage(state.closedReason),
        },
      },
      { status: 404 },
    );
  }
  return NextResponse.json(state.form);
}

/**
 * Public submission. No auth: the token stands for the role. Everything in
 * the multipart body is validated before it reaches the database.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const address = clientIp(request);

  const addressLimit = await overRateLimits([
    {
      key: rateLimitKey(["apply", "submit", "ip", address]),
      limit: SUBMISSIONS_PER_HOUR_PER_ADDRESS,
      windowSeconds: 3600,
    },
  ]);
  if (addressLimit.limited) return rateLimited(addressLimit.retryAfterSeconds);

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Send the form as multipart/form-data." } },
      { status: 400 },
    );
  }

  // The email is read before the limits so one address cannot send hundreds of
  // applications by stating a different name each time.
  const email = form.get("email");
  const emailText = typeof email === "string" ? email.trim().toLowerCase() : "";

  const workLimit = await overRateLimits([
    {
      key: rateLimitKey(["apply", "submit", "link", token]),
      limit: SUBMISSIONS_PER_HOUR_PER_LINK,
      windowSeconds: 3600,
    },
    {
      key: rateLimitKey(["apply", "submit", "email", token, emailText]),
      limit: SUBMISSIONS_PER_HOUR_PER_EMAIL,
      windowSeconds: 3600,
    },
  ]);
  if (workLimit.limited) return rateLimited(workLimit.retryAfterSeconds);

  const result = await submitApplication(token, form);
  if (result.ok) {
    const resume = form.get("resume");
    return NextResponse.json({
      ok: true,
      applicationId: result.applicationId,
      // Present on a new application: the private link to replace the resume.
      resumeToken: result.resumeUpdateToken,
      // True when this submission replaced the resume on an earlier one.
      updated: result.updated,
      previousFileName: result.previousFileName,
      fileName: resume instanceof File ? resume.name : null,
    });
  }

  const status =
    result.code === "token" ? 404 : result.code === "duplicate" ? 409 : result.code === "closed" ? 410 : 400;
  return NextResponse.json(
    { error: { code: result.code.toUpperCase(), message: result.message } },
    { status },
  );
}
