import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACTIVITY_GROUPS } from "@/lib/auth/accounts.logic";
import { requireAdmin } from "@/lib/auth/guards";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

/**
 * The activity log, newest first (admin only). Query: `person` (an actor id),
 * `group` (see ACTIVITY_GROUPS), `before` (an entry id, for the next page).
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const group = params.get("group");
  const before = Number(params.get("before"));
  const entries = await getAccountsRepository().listActivity({
    actorId: params.get("person") || undefined,
    group: group && group in ACTIVITY_GROUPS ? group : undefined,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: 50,
  });
  return NextResponse.json({ entries, next: entries.length === 50 ? entries.at(-1)?.id ?? null : null });
}
