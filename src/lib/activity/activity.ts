import "server-only";
import { getActor, requestAddress, type Actor } from "@/lib/auth/actor";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

export interface ActivityInput {
  /** "<group>.<verb>", e.g. "role.created", "interview.deleted". */
  action: string;
  targetType?: string;
  targetId?: string;
  /** One line a person can read: "Created role AI Developer". */
  summary: string;
  details?: Record<string, unknown>;
  /** Pass when already known (sign-in, before the cookie exists). */
  actor?: Actor | null;
}

/**
 * Records who did what. Awaited, so it finishes inside the request (work left
 * after a response is throttled), but it never fails the action itself: a
 * change that went through is not undone because logging it hiccupped.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    const actor = input.actor === undefined ? await getActor() : input.actor;
    await getAccountsRepository().addActivity({
      actorId: actor?.id ?? "anonymous",
      actorName: actor?.name ?? "Unknown",
      actorEmail: actor?.email ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary,
      details: input.details ?? null,
      ip: await requestAddress().catch(() => null),
    });
  } catch (error) {
    console.error(`[activity] could not record ${input.action}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
