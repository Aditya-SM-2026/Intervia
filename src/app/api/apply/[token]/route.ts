import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getPublicApplicationState,
  submitApplication,
} from "@/lib/roles/application.service";
import { closedReasonMessage } from "@/lib/roles/form-link-status";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Simple in-memory guard against form spam; per instance, best effort. Kept
 * generous because a college lab or a whole office can share one public IP.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 60_000;
const RATE_LIMIT_MAX = 60;
const submissionsByIp = new Map<string, number[]>();

function overRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (submissionsByIp.get(key) ?? []).filter(
    (at) => now - at < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    submissionsByIp.set(key, recent);
    return true;
  }
  recent.push(now);
  submissionsByIp.set(key, recent);
  return false;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

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
 * Public submission. No auth: the token stands for the role. Everything in
 * the multipart body is validated before it reaches the database.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  if (overRateLimit(`${clientIp(request)}:${token}`)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many applications from this network. Try again later." } },
      { status: 429 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Send the form as multipart/form-data." } },
      { status: 400 },
    );
  }

  const result = await submitApplication(token, form);
  if (result.ok) return NextResponse.json({ ok: true, applicationId: result.applicationId });

  const status =
    result.code === "token" ? 404 : result.code === "duplicate" ? 409 : result.code === "closed" ? 410 : 400;
  return NextResponse.json(
    { error: { code: result.code.toUpperCase(), message: result.message } },
    { status },
  );
}
