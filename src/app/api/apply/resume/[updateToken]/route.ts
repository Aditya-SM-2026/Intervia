import { NextResponse, type NextRequest } from "next/server";
import {
  getResumeUpdateState,
  replaceApplicationResume,
} from "@/lib/roles/application.service";
import { clientIp, overPublicRateLimit } from "@/lib/http/public-rate-limit";

type RouteContext = { params: Promise<{ updateToken: string }> };

/**
 * The candidate's private replace-resume link. GET says what is on record,
 * POST swaps the file. The token is the credential, so no sign-in is needed;
 * it is random, unguessable and expires a week after the last upload.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { updateToken } = await context.params;
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
  if (overPublicRateLimit(`${clientIp(request.headers)}:resume:${updateToken.slice(0, 8)}`)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many uploads from this network. Try again later." } },
      { status: 429 },
    );
  }

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
