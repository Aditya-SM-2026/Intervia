/**
 * Which stored files belong to which interview or application. Recordings live
 * under "<roomId>/", the interviewer audio and mixed video under
 * "interviews/<roomId>/", resumes under "resumes/<roomId or applicationId>/".
 */

// Interview ids are 16 random bytes in base64url (22 characters); application
// ids are "app_" plus 12 random bytes (16 characters). Nothing else matches,
// so other folders in the bucket are never touched.
const ROOM = "[A-Za-z0-9_-]{22}";
const APP = "app_[A-Za-z0-9_-]{16}";
const OWNER_PATTERNS = [
  new RegExp(`^interviews/(${ROOM})/`),
  new RegExp(`^resumes/(${ROOM}|${APP})/`),
  new RegExp(`^(${ROOM})/`),
];

/** The interview or application an object belongs to, or null for anything else. */
export function ownerOf(objectName: string): string | null {
  for (const pattern of OWNER_PATTERNS) {
    const match = pattern.exec(objectName);
    if (match) return match[1];
  }
  return null;
}

/** The prefixes to clear when one interview or application is deleted. */
export function prefixesFor(id: string): string[] {
  return [`${id}/`, `interviews/${id}/`, `resumes/${id}/`];
}

/**
 * Files the hourly clean-up may remove: their owner no longer exists, they
 * were created after the clean-up began (older copied data is never touched),
 * and they are old enough that no upload is still in flight.
 */
export function orphanedObjects(
  objects: readonly { name: string; timeCreated: string }[],
  existingOwners: ReadonlySet<string>,
  options: { notBefore: number; olderThanMs: number; now: number },
): string[] {
  return objects
    .filter((object) => {
      const owner = ownerOf(object.name);
      if (!owner || existingOwners.has(owner)) return false;
      const created = Date.parse(object.timeCreated);
      return Number.isFinite(created) && created >= options.notBefore && options.now - created > options.olderThanMs;
    })
    .map((object) => object.name);
}
