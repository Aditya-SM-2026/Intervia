import type {
  FormLinkClosedReason,
  FormLinkStatus,
  RoleFormLink,
} from "@/lib/roles/application.types";

const HOUR_MS = 60 * 60 * 1000;

/** The deadline a link was given, or null when it has no time limit. */
export function linkExpiresAt(link: RoleFormLink): string | null {
  if (link.expiresAfterHours === null || link.expiresAfterHours === undefined) return null;
  const started = Date.parse(link.roundStartedAt);
  if (!Number.isFinite(started)) return null;
  return new Date(started + link.expiresAfterHours * HOUR_MS).toISOString();
}

/**
 * Whether a link accepts applications right now. A link is closed when the
 * recruiter turned it off, when its time limit has passed, or when it has
 * collected as many applications as it was allowed. Time passing never opens
 * a closed link again.
 */
export function formLinkStatus(
  link: RoleFormLink,
  applicationsReceived: number,
  now: number = Date.now(),
): FormLinkStatus {
  const expiresAt = linkExpiresAt(link);
  const maxApplications = link.maxApplications ?? null;
  const expiresAfterHours = link.expiresAfterHours ?? null;

  let closedReason: FormLinkClosedReason | null = null;
  if (link.revokedAt) {
    closedReason = "revoked";
  } else if (expiresAt !== null && now >= Date.parse(expiresAt)) {
    closedReason = "expired";
  } else if (maxApplications !== null && applicationsReceived >= maxApplications) {
    closedReason = "limit";
  }

  return {
    open: closedReason === null,
    closedReason,
    applicationsReceived,
    maxApplications,
    expiresAfterHours,
    expiresAt,
    roundStartedAt: link.roundStartedAt,
  };
}

/** Sentence shown to someone who opens a link that is no longer taking answers. */
export function closedReasonMessage(reason: FormLinkClosedReason | null): string {
  switch (reason) {
    case "limit":
      return "This link reached its application limit. Ask the recruiter who shared it for a new one.";
    case "expired":
      return "This link has expired. Ask the recruiter who shared it for a new one.";
    case "revoked":
      return "This link was turned off by the recruiter. Ask them for a new one.";
    default:
      return "This link is no longer accepting applications. Ask the recruiter who shared it for a new one.";
  }
}
