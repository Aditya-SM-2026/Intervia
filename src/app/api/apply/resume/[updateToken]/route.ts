import { NextResponse, type NextRequest } from "next/server";
import { clientAddress } from "@/lib/auth/accounts.logic";
import {
  overRateLimits,
  rateLimitedMessage,
  rateLimitKey,
} from "@/lib/http/rate-limit";
import {
  getResumeUpdateState,
  replaceApplicationResume,
} from "@/lib/roles/application.service";

type RouteContext = { params: Promise<{ updateToken: string }> };

/** A private link is used once or twice; a burst means something is wrong. */
const UPLOADS_PER_HOUR_PER_LINK = 20;
const UPLOADS_PER_HOUR_PER_ADDRESS = 100;
const LOADS_PER_MINUTE_PER_ADDRESS = 60;

function clientIp(request: NextRequest): string {
  return clientAddress(request.headers.get("x-forwarded-for"));
}

function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: rateLimitedMessage(retryAfterSeconds) } },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/**
 * The candidate's private replace-resume link. GET says what is on record,
 * POST swaps the file. The token is the credential, so no sign-in is needed;
 * it is random, unguessable and expires a week after the last upload.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { updateToken } = await context.params;

  const limit = await overRateLimits([
    {
      key: rateLimitKey(["resume", "load", clientIp(request)]),
      limit: LOADS_PER_MINUTE_PER_ADDRESS,
      windowSeconds: 60,
    },
  ]);
  if (limit.limited) return rateLimited(limit.retryAfterSeconds);

  const state = await getResumeUpdateState(updateToken);
  if (!state) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "This resume link is not valid." } },
      { status: 404 },
    );
  }
  return NextResponse.json(state);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { updateToken } = await context.params;

  const limit = await overRateLimits([
    {
      key: rateLimitKey(["resume", "upload", "link", updateToken]),
      limit: UPLOADS_PER_HOUR_PER_LINK,
      windowSeconds: 3600,
    },
    {
      key: rateLimitKey(["resume", "upload", "ip", clientIp(request)]),
      limit: UPLOADS_PER_HOUR_PER_ADDRESS,
      windowSeconds: 3600,
    },
  ]);
  if (limit.limited) return rateLimited(limit.retryAfterSeconds);

  const form = await request.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Attach your resume as a PDF, DOC or DOCX file." } },
      { status: 400 },
    );
  }

  const result = await replaceApplicationResume(updateToken, file);
  if (result.ok) {
    return NextResponse.json({ ok: true, fileName: result.fileName, updatedAt: result.updatedAt });
  }

  const status =
    result.code === "token"
      ? 404
      : result.code === "expired" || result.code === "closed"
        ? 410
        : 400;
  return NextResponse.json(
    { error: { code: result.code.toUpperCase(), message: result.message } },
    { status },
  );
}
