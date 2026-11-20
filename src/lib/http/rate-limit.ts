import "server-only";
import { areRateLimitsDisabled } from "@/lib/config/env";
import { hitRateLimit } from "@/server/repositories/rate-limit-repository";

/**
 * Rate limits for the public, unauthenticated endpoints.
 *
 * Counts live in Postgres (see rate-limit-repository), so a limit holds across
 * every Cloud Run instance and survives cold starts. A broken counter must
 * never lock a real candidate out, so a failed check is treated as "allow" and
 * logged instead. RATE_LIMIT_DISABLED turns every rule off at once, which is
 * how predev runs without limits.
 */

export type RateLimitRule = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  limited: boolean;
  retryAfterSeconds: number;
  rule: RateLimitRule | null;
};

const ALLOWED: RateLimitResult = { limited: false, retryAfterSeconds: 0, rule: null };

function secondsLeftInWindow(windowSeconds: number): number {
  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
  return Math.max(1, windowSeconds - elapsed);
}

export async function overRateLimits(rules: RateLimitRule[]): Promise<RateLimitResult> {
  if (areRateLimitsDisabled()) return ALLOWED;
  for (const rule of rules) {
    try {
      const hits = await hitRateLimit(rule.key, rule.windowSeconds);
      if (hits > rule.limit) {
        return {
          limited: true,
          retryAfterSeconds: secondsLeftInWindow(rule.windowSeconds),
          rule,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[rate-limit] ${rule.key} check failed, allowing: ${message}`);
    }
  }
  return ALLOWED;
}

/** Message shown when a limit stops a request. Plain, and says what to do next. */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many requests from this network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Normalises an address so one client cannot dodge a limit by changing case. */
export function rateLimitKey(parts: string[]): string {
  return parts
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join(":");
}
