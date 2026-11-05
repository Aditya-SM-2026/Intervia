/**
 * The public base URL used in links we hand out (application forms today, any
 * shared link later).
 *
 * Cloud Run runs this server on 0.0.0.0:8080 and terminates TLS at its edge,
 * so a request's own origin can be the container's internal address. That must
 * never end up in a link a recruiter copies: prefer an explicitly configured
 * base URL, then the host the browser actually used, then the request origin
 * as a last resort.
 */

export interface AppOriginInput {
  /** APP_BASE_URL, when the environment sets one. */
  configured?: string | null;
  /** Original host, from x-forwarded-host or the Host header. */
  host?: string | null;
  /** x-forwarded-proto, when a proxy set it. */
  proto?: string | null;
  /** request.nextUrl.origin; last resort. */
  fallback?: string | null;
}

/** Addresses that mean "this machine" and cannot be shared with anyone else. */
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "::1", "127.0.0.1"]);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeConfigured(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return trimTrailingSlash(withScheme);
}

function usableHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (host === "") return null;
  const bracketed = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : null;
  const hostname = bracketed ?? host.split(":")[0] ?? "";
  if (WILDCARD_HOSTS.has(hostname)) return null;
  return host;
}

export function resolveAppOrigin(input: AppOriginInput): string {
  const configured = input.configured ? normalizeConfigured(input.configured) : null;
  if (configured) return configured;

  const host = usableHost(input.host);
  if (host) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
    const proto = input.proto?.toLowerCase() === "http" || isLocal ? "http" : "https";
    return `${proto}://${host}`;
  }

  const fallback = input.fallback?.trim();
  return fallback ? trimTrailingSlash(fallback) : "";
}
