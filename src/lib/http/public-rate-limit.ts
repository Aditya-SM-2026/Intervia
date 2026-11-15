import { clientAddress } from "@/lib/auth/accounts.logic";
/**
 * Best-effort, per-instance rate limit for the public application endpoints.
 *
 * Nothing is shared between Cloud Run instances, so this only stops a single
 * noisy client from hammering one instance. It is deliberately generous: a
 * college lab or an office can share one public IP.
 */

const WINDOW_MS = 60 * 60_000;
const DEFAULT_MAX = 60;

const hitsByKey = new Map<string, number[]>();

export function overPublicRateLimit(key: string, max: number = DEFAULT_MAX): boolean {
  const now = Date.now();
  const recent = (hitsByKey.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= max) {
    hitsByKey.set(key, recent);
    return true;
  }
  recent.push(now);
  hitsByKey.set(key, recent);
  return false;
}

/**
 * The client's address. Google's front end appends the address it saw, so the
 * last X-Forwarded-For entry is the one a client cannot choose.
 */
export function clientIp(headers: Headers): string {
  return clientAddress(headers.get("x-forwarded-for"));
}
