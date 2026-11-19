import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getPublicApplicationState,
  submitApplication,
} from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";
import { allowAttempt, clientIp } from "@/lib/roles/apply-rate-limit";
import { checkApplySlot } from "@/lib/roles/apply-slot";

type RouteContext = { params: Promise<{ token: string }> };

const HOUR_MS = 60 * 60_000;

/**
 * A college or office shares one public IP, so these are flood backstops, not
 * the meaningful limit. The real pacing is the per-candidate submission slot,
 * and the real duplicate guard is the unique application row in Postgres.
 */
const SUBMIT_MAX_PER_IP = 5_000;
const SUBMIT_MAX_PER_EMAIL = 10;

/** What the public form needs: the role, its description and its questions. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
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

  if (!allowAttempt(`submit:${clientIp(request)}`, SUBMIT_MAX_PER_IP, HOUR_MS)) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many applications from this network. Please try again later.",
        },
      },
      { status: 429 },
    );
  }

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

  const rawEmail = form.get("email");
  const submittedEmail = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (
    submittedEmail &&
    !allowAttempt(`email:${token}:${submittedEmail}`, SUBMIT_MAX_PER_EMAIL, HOUR_MS)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message:
            "This email address has been submitted several times. Please wait a little, then try again.",
        },
      },
      { status: 429 },
    );
  }

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
