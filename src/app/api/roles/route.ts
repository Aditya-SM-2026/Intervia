import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { ZodError } from "zod";
import {
  createRole,
  deleteRoles,
  listRoles,
} from "@/lib/roles/role.service";
import { formatRoleValidationIssues } from "@/lib/roles/role.validation";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import type { RoleStatus } from "@/lib/roles/role.types";
import type { RolesResponse } from "@/lib/roles/role.types";

/**
 * Roles API. GET lists roles (query: `q`, `status`); POST creates one.
 * Recruiter-only: candidate and score data sit behind the dashboard auth.
 */
export async function GET(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusRaw = request.nextUrl.searchParams.get("status");
  const status =
    statusRaw === "open" || statusRaw === "completed" ? (statusRaw as RoleStatus) : undefined;

  try {
    const roles = await listRoles({ q: q || undefined, status });
    const body: RolesResponse = { roles };
    return NextResponse.json(body);
  } catch (error) {
    console.error(`[roles] list failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not load the roles. Please try again.");
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }

  try {
    const role = await createRole(payload);
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return roleErrorResponse("INVALID_INPUT", formatRoleValidationIssues(error));
    }
    console.error(`[roles] create failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not create the role. Please try again.");
  }
}

/**
 * Deletes several roles at once. Body: `{ "ids": ["role_...", ...] }`.
 * Each role's candidate interviews go with it.
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }

  const ids =
    payload && typeof payload === "object" && Array.isArray((payload as { ids?: unknown }).ids)
      ? ((payload as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string"))
      : null;
  if (!ids || ids.length === 0) {
    return roleErrorResponse("INVALID_INPUT", "Choose at least one role to delete.");
  }
  if (ids.length > 200) {
    return roleErrorResponse("INVALID_INPUT", "Delete 200 roles at most in one go.");
  }

  try {
    const result = await deleteRoles(ids);
    if (result.roles === 0) {
      return roleErrorResponse("ROLE_NOT_FOUND", "None of those roles exist any more.");
    }
    return NextResponse.json({ deleted: result.roles, interviews: result.interviews });
  } catch (error) {
    console.error(`[roles] delete failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not delete the roles. Please try again.");
  }
}