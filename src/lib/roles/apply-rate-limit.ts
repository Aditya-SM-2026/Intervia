import "server-only";

/**
 * Best-effort, per-instance attempt counter for the public form.
 *
 * This is deliberately not the main guard anymore: a whole campus can share
 * one public IP, so the limit is applied per email for submissions and only as
 * a very high backstop per IP. Postgres still owns the real duplicate check.
 */

const buckets = new Map<string, number[]>();

/** Keeps the bookkeeping bounded when many one-off keys pass through. */
const MAX_KEYS = 20_000;

function prune(now: number, windowMs: number) {
  for (const [key, times] of buckets) {
    const recent = times.filter((at) => now - at < windowMs);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}

/** Records one attempt and says whether it is still inside the allowance. */
export function allowAttempt(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const recent = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) prune(now, windowMs);
  return true;
}

export function clientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
