import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecruiter } from "@/lib/auth/guards";
import { decideRoleCandidates } from "@/lib/roles/role.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";

type RouteParams = { params: Promise<{ roleId: string }> };

/**
 * Bulk hiring decisions from the HR leaderboard: advance, hold or reject
 * several candidates of one role in a single request. The decision lands on
 * each candidate's most recent interview in the role. Per-candidate failures
 * are reported individually; one bad row never blocks the others.
 */

const bulkDecisionSchema = z.object({
  decision: z.enum(["advance", "hold", "reject"]),
  note: z.string().trim().max(2000).optional(),
  candidateIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one candidate.")
    .max(100, "Decide on at most 100 candidates at a time."),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return roleErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
  }
  const parsed = bulkDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return roleErrorResponse("INVALID_INPUT", "Provide a decision and 1-100 candidate ids.");
  }

  try {
    const result = await decideRoleCandidates(
      roleId,
      parsed.data.candidateIds,
      parsed.data.decision,
      parsed.data.note,
    );
    if (!result) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[roles] bulk decision failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not record the decisions. Please try again.");
  }
}