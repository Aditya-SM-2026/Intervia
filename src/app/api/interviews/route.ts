import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createInterviewRoom } from "@/lib/interviews/interview.service";
import {
  createInterviewSchema,
  formatValidationIssues,
} from "@/lib/interviews/interview.validation";
import type { InterviewApiError } from "@/lib/interviews/interview.types";

function invalidInput(message: string) {
  const body: InterviewApiError = { error: { code: "INVALID_INPUT", message } };
  return NextResponse.json(body, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidInput("Request body must be valid JSON.");
  }

  const parsed = createInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(formatValidationIssues(parsed.error));
  }

  const room = await createInterviewRoom(parsed.data);
  const candidateUrl = new URL(
    `/interview/${room.id}`,
    publicOrigin(request),
  ).toString();

  return NextResponse.json({ room, candidateUrl }, { status: 201 });
}

/**
 * The externally visible origin. Behind a proxy (Cloud Run, tunnels) the
 * Next.js request URL reflects the internal listener, so the forwarded
 * headers take precedence when present.
 */
function publicOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const safeHost = /^[a-zA-Z0-9.\-:]+$/.test(host) ? host : "localhost";
  return `${proto}://${safeHost}`;
}