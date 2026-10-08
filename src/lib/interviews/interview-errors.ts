import { NextResponse } from "next/server";
import type { InterviewApiError } from "./interview.types";

const HTTP_STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  ROOM_NOT_FOUND: 404,
  ROOM_EXPIRED: 410,
  ROOM_UNAVAILABLE: 409,
  EMAIL_MISMATCH: 403,
  SERVER_ERROR: 500,
} as const;

export type InterviewErrorCode = keyof typeof HTTP_STATUS_BY_CODE;

export function interviewErrorResponse(
  code: InterviewErrorCode,
  message: string,
) {
  const body: InterviewApiError = { error: { code, message } };
  return NextResponse.json(body, { status: HTTP_STATUS_BY_CODE[code] });
}