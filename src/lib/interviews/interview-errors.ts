import { NextResponse } from "next/server";
import type { InterviewApiError, InterviewRoom } from "./interview.types";

/**
 * Thrown when a scheduler re-submits the same candidate, role and moment
 * while an earlier interview is still open. Carries the existing room so the
 * API can return its link instead of creating a second interview.
 */
export class DuplicateInterviewError extends Error {
  constructor(readonly room: InterviewRoom) {
    super("An identical interview is already scheduled for this candidate.");
    this.name = "DuplicateInterviewError";
  }
}

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