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
import { checkApplySlot } from "@/lib/roles/apply-slot";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Limits for the public form. Counts live in Postgres, so these numbers hold
 * across every instance rather than being multiplied by them.
 *
 * The queue is what paces a drive; these are flood backstops. A college lab or
 * a whole office can put a thousand candidates behind one public address, so
 * the per-address numbers have to sit above the size of the drive. Duplicates
 * and spam are stopped by the per-email limit and the submission slot instead.
 */
const FORM_LOADS_PER_MINUTE = 2_000;
const SUBMISSIONS_PER_HOUR_PER_ADDRESS = 5_000;
const SUBMISSIONS_PER_HOUR_PER_EMAIL = 10;
const SUBMISSIONS_PER_HOUR_PER_LINK = 10_000;

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
 * Public submission. No auth: the token stands for the role. The signed slot is
 * checked before the body is read, so an early or missing ticket costs nothing.
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

  const slot = checkApplySlot(token, request.headers.get("x-apply-slot"));
  if (!slot.ok) {
    if (slot.reason === "early") {
      const wait = slot.retryAfterSeconds ?? 1;
      return NextResponse.json(
        {
          error: {
            code: "WAIT",
            message: "High demand right now. Please wait for your submission timer.",
          },
          retryAfterSeconds: wait,
        },
        { status: 425, headers: { "retry-after": String(wait) } },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: slot.reason === "expired" ? "SLOT_EXPIRED" : "SLOT_REQUIRED",
          message:
            slot.reason === "expired"
              ? "Your place in line expired. Reserve a new place to send your application."
              : "Reserve a place in line before sending your application.",
        },
      },
      { status: 428 },
    );
  }

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
