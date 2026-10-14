import { NextResponse } from "next/server";

const HTTP_STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  ROLE_NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

export type RoleErrorCode = keyof typeof HTTP_STATUS_BY_CODE;

export function roleErrorResponse(code: RoleErrorCode, message: string) {
  const body = { error: { code, message } };
  return NextResponse.json(body, { status: HTTP_STATUS_BY_CODE[code] });
}

export function describeRoleError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}