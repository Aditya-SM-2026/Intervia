import "server-only";
import { recordingsBucket } from "@/lib/recordings/gcs-upload";
import { sharedPool } from "@/server/db/pool";
import { orphanedObjects, prefixesFor } from "./cleanup.logic";
import { deleteStoredObject, listStoredObjects } from "./gcs";

/** Files created before this are older copied data and never cleaned up. */
const CLEANUP_STARTED = Date.parse("2026-11-15T00:00:00Z");
/** Leave fresh files alone: an upload may still be writing its database row. */
const SETTLE_MS = 6 * 60 * 60 * 1000;

/**
 * Deletes every stored file of these interviews or applications: candidate
 * recording, interviewer audio, mixed video and resume. Returns how many
 * files were removed. Never throws; the hourly sweep retries what is left.
 */
export async function deleteFilesFor(ids: readonly string[]): Promise<number> {
  const bucket = recordingsBucket();
  if (!bucket || ids.length === 0) return 0;
  let removed = 0;
  for (const id of ids) {
    for (const prefix of prefixesFor(id)) {
      const objects = await listStoredObjects(bucket, prefix).catch(() => []);
      for (const object of objects) {
        if (await deleteStoredObject(bucket, object.name).catch(() => false)) removed += 1;
      }
    }
  }
  return removed;
}

/**
 * The hourly sweep: removes files whose interview or application no longer
 * exists (a role or candidate was deleted). Only files from CLEANUP_STARTED on.
 */
export async function sweepOrphanFiles(): Promise<{ checked: number; removed: number }> {
  const bucket = recordingsBucket();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!bucket || !connectionString) return { checked: 0, removed: 0 };
  const objects = (await listStoredObjects(bucket, "")).filter((object) => Date.parse(object.timeCreated) >= CLEANUP_STARTED);
  if (objects.length === 0) return { checked: 0, removed: 0 };
  const owners = [...new Set(objects.map((object) => object.name.split("/")[object.name.startsWith("interviews/") || object.name.startsWith("resumes/") ? 1 : 0]))];
  const result = await sharedPool(connectionString).query<{ id: string }>(
    "SELECT id FROM interviews WHERE id = ANY($1) UNION SELECT id FROM role_applications WHERE id = ANY($1)",
    [owners],
  );
  const existing = new Set(result.rows.map((row) => row.id));
  const orphans = orphanedObjects(objects, existing, { notBefore: CLEANUP_STARTED, olderThanMs: SETTLE_MS, now: Date.now() });
  let removed = 0;
  for (const name of orphans) {
    if (await deleteStoredObject(bucket, name).catch(() => false)) removed += 1;
  }
  return { checked: objects.length, removed };
}
